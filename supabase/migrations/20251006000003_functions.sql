-- Callable functions. Errors are raised with P0001 and a stable message that the app maps to text (docs/api.md).

-- accounts ------------------------------------------------------------------

create function accounts.handle_valid(p_handle text) returns boolean
language sql immutable set search_path = ''
as $$
  select p_handle ~ '^[a-z0-9_]{3,20}$'
    and p_handle not in ('admin', 'administrator', 'rdv', 'rdvgarage', 'rdv_garage', 'support', 'official',
                         'staff', 'mod', 'moderator', 'root', 'system', 'null', 'undefined', 'help', 'security')
    and p_handle not like 'sim\_%'
    and p_handle not like 'deleted\_%'
$$;

-- Service role only: called by the register function after the invite is validated.
create function accounts.create_profile(
  p_id uuid, p_handle text, p_invited_by uuid, p_invite_id uuid, p_terms_version text,
  p_synthetic boolean default false
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not p_synthetic and not accounts.handle_valid(p_handle) then
    perform private.fail('handle_invalid');
  end if;
  begin
    insert into accounts.profiles (id, handle, invited_by, invite_id, terms_version, terms_accepted_at, is_synthetic)
    values (p_id, p_handle, p_invited_by, p_invite_id, p_terms_version, now(), p_synthetic);
  exception when unique_violation then
    perform private.fail('handle_taken');
  end;
end $$;

create function accounts.handle_available(p_handle text) returns boolean
language sql stable security definer set search_path = ''
as $$ select not exists (select 1 from accounts.profiles where handle = p_handle) $$;

create function accounts.my_profile() returns table (
  id uuid, handle text, avatar_path text, status text, terms_version text, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then perform private.fail('unauthenticated'); end if;
  return query
    select p.id, p.handle, p.avatar_path, p.status, p.terms_version, p.created_at
    from accounts.profiles p where p.id = uid;
end $$;

create function accounts.update_profile(p_handle text default null, p_avatar_path text default null, p_clear_avatar boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  cur accounts.profiles;
begin
  select * into cur from accounts.profiles where id = uid;
  if p_handle is not null and p_handle <> cur.handle then
    if not accounts.handle_valid(p_handle) then
      perform private.fail('handle_invalid');
    end if;
    if cur.handle_changed_at is not null
       and cur.handle_changed_at > now() - make_interval(days => private.setting('handle_cooldown_days')::integer) then
      perform private.fail('handle_cooldown');
    end if;
    begin
      update accounts.profiles set handle = p_handle, handle_changed_at = now() where id = uid;
    exception when unique_violation then
      perform private.fail('handle_taken');
    end;
  end if;
  if p_clear_avatar then
    update accounts.profiles set avatar_path = null where id = uid;
  elsif p_avatar_path is not null then
    if split_part(p_avatar_path, '/', 1) <> uid::text then
      perform private.fail('not_a_member');
    end if;
    update accounts.profiles set avatar_path = p_avatar_path where id = uid;
  end if;
end $$;

-- Signed-in devices. auth.sessions is owned by Supabase Auth; this reads it for the caller only.
create function accounts.list_sessions() returns table (
  id uuid, created_at timestamptz, last_seen_at timestamptz, user_agent text, is_current boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  cur uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  return query
    select s.id, s.created_at, coalesce(s.refreshed_at, s.updated_at, s.created_at), s.user_agent::text, (s.id = cur)
    from auth.sessions s
    where s.user_id = uid
    order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc;
end $$;

create function accounts.revoke_session(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  delete from auth.sessions where id = p_id and user_id = uid;
  if not found then perform private.fail('session_not_found'); end if;
end $$;

-- Signs out every device except the one making the call. Used after a password reset or change.
create function accounts.revoke_other_sessions() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  cur uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  n integer;
begin
  delete from auth.sessions where user_id = uid and id is distinct from cur;
  get diagnostics n = row_count;
  return n;
end $$;

-- referral ------------------------------------------------------------------

-- Anonymous. Returns a status only: valid, expired, revoked, disabled, invalid.
create function referral.check_invite(p_code text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  inv referral.invites;
  inviter_status text;
  v_code text := upper(trim(coalesce(p_code, '')));
  ip text := private.client_ip();
begin
  perform private.hit_rate_limit('check_invite:' || ip, 120, 3600);
  select * into inv from referral.invites i where i.code = v_code;
  if not found then
    perform private.hit_rate_limit('check_invite_miss:' || ip, 20, 3600);
    return 'invalid';
  end if;
  select status into inviter_status from accounts.profiles where id = inv.inviter_id;
  if inv.status = 'revoked' or inviter_status is distinct from 'active' then return 'revoked'; end if;
  if inv.status = 'disabled' then return 'disabled'; end if;
  if inv.expires_at < now() then return 'expired'; end if;
  return 'valid';
end $$;

-- Service role only (register function). Honors an invite for a grace period after it expires.
create function referral.validate_for_register(p_code text) returns table (invite_id uuid, inviter_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  inv referral.invites;
  inviter_status text;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  select * into inv from referral.invites i where i.code = v_code;
  if not found then perform private.fail('invalid_invite'); end if;
  select status into inviter_status from accounts.profiles where id = inv.inviter_id;
  if inv.status <> 'active' or inviter_status is distinct from 'active' then
    perform private.fail('revoked_invite');
  end if;
  if inv.expires_at + make_interval(mins => private.setting('invite_register_grace_minutes')::integer) < now() then
    perform private.fail('expired_invite');
  end if;
  return query select inv.id, inv.inviter_id;
end $$;

create function referral.create_invite() returns table (id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  new_code text;
  new_id uuid;
  new_expires timestamptz := now() + make_interval(hours => private.setting('invite_ttl_hours')::integer);
  attempts integer := 0;
begin
  loop
    new_code := private.gen_code(12);
    begin
      insert into referral.invites (inviter_id, code, expires_at)
      values (uid, new_code, new_expires)
      returning referral.invites.id into new_id;
      exit;
    exception when unique_violation then
      attempts := attempts + 1;
      if attempts > 5 then raise; end if;
    end;
  end loop;
  return query select new_id, new_code, new_expires;
end $$;

create function referral.revoke_invite(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  update referral.invites
  set status = 'revoked', revoked_by = 'inviter', revoked_at = now()
  where id = p_id and inviter_id = uid and status = 'active';
  if not found then perform private.fail('invalid_invite'); end if;
end $$;

create function referral.list_my_invites() returns table (
  id uuid, code text, created_at timestamptz, expires_at timestamptz, status text, joined jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  return query
    select i.id, i.code, i.created_at, i.expires_at,
           case when i.status = 'active' and i.expires_at < now() then 'expired' else i.status end,
           coalesce((
             select jsonb_agg(jsonb_build_object('handle', p.handle, 'joined_at', p.created_at) order by p.created_at)
             from accounts.profiles p where p.invite_id = i.id and p.status <> 'deleted'
           ), '[]'::jsonb)
    from referral.invites i
    where i.inviter_id = uid
    order by i.created_at desc;
end $$;

-- crews ---------------------------------------------------------------------

create function crews.create_crew(p_name text, p_description text default null, p_avatar_path text default null)
returns table (id uuid, link_code text)
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  crew_id uuid;
  code text;
  attempts integer := 0;
begin
  p_name := trim(coalesce(p_name, ''));
  if char_length(p_name) < 3 or char_length(p_name) > 30 then perform private.fail('crew_name_invalid'); end if;
  if p_description is not null and char_length(p_description) > 140 then perform private.fail('crew_description_invalid'); end if;
  loop
    code := private.gen_code(16);
    begin
      insert into crews.crews (name, description, avatar_path, owner_id, link_code)
      values (p_name, nullif(trim(p_description), ''), p_avatar_path, uid, code)
      returning crews.crews.id into crew_id;
      exit;
    exception when unique_violation then
      attempts := attempts + 1;
      if attempts > 5 then raise; end if;
    end;
  end loop;
  insert into crews.members (crew_id, user_id, role) values (crew_id, uid, 'owner');
  insert into crews.selections (user_id, crew_id) values (uid, crew_id);
  return query select crew_id, code;
end $$;

create function crews.join_crew(p_link_code text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  crew_id uuid;
begin
  perform private.hit_rate_limit('join_crew:' || uid::text, 60, 3600);
  select c.id into crew_id from crews.crews c
  where c.link_code = upper(trim(coalesce(p_link_code, ''))) and c.status = 'active';
  if crew_id is null then perform private.fail('invalid_crew_link'); end if;
  insert into crews.members (crew_id, user_id, role) values (crew_id, uid, 'member') on conflict do nothing;
  insert into crews.selections (user_id, crew_id) values (uid, crew_id) on conflict do nothing;
  return crew_id;
end $$;

-- Removes a user from a crew everywhere: membership, selection, and any shared live session.
create function crews.drop_membership(p_crew uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from live.session_crews sc
  using live.sessions s
  where sc.session_id = s.id and s.user_id = p_user and sc.crew_id = p_crew;
  delete from crews.selections where user_id = p_user and crew_id = p_crew;
  delete from crews.members where user_id = p_user and crew_id = p_crew;
end $$;

create function crews.leave_crew(p_crew uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r text;
begin
  select role into r from crews.members where crew_id = p_crew and user_id = uid;
  if r is null then perform private.fail('not_a_member'); end if;
  if r = 'owner' then perform private.fail('owner_must_transfer'); end if;
  perform crews.drop_membership(p_crew, uid);
end $$;

create function crews.remove_member(p_crew uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  if not exists (select 1 from crews.members where crew_id = p_crew and user_id = uid and role = 'owner') then
    perform private.fail('not_owner');
  end if;
  if p_user = uid then perform private.fail('owner_must_transfer'); end if;
  if not exists (select 1 from crews.members where crew_id = p_crew and user_id = p_user) then
    perform private.fail('not_a_member');
  end if;
  perform crews.drop_membership(p_crew, p_user);
end $$;

create function crews.transfer_ownership(p_crew uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  if not exists (select 1 from crews.members where crew_id = p_crew and user_id = uid and role = 'owner') then
    perform private.fail('not_owner');
  end if;
  if p_user = uid or not exists (select 1 from crews.members where crew_id = p_crew and user_id = p_user) then
    perform private.fail('not_a_member');
  end if;
  update crews.members set role = 'member' where crew_id = p_crew and user_id = uid;
  update crews.members set role = 'owner' where crew_id = p_crew and user_id = p_user;
  update crews.crews set owner_id = p_user where id = p_crew;
end $$;

create function crews.regenerate_crew_link(p_crew uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  code text;
begin
  if not exists (select 1 from crews.members where crew_id = p_crew and user_id = uid and role = 'owner') then
    perform private.fail('not_owner');
  end if;
  code := private.gen_code(16);
  update crews.crews set link_code = code where id = p_crew and status = 'active';
  return code;
end $$;

-- Dissolves a crew: members, selections, shared sessions and the link all go. The row stays for history.
create function crews.dissolve(p_crew uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from live.session_crews where crew_id = p_crew;
  delete from crews.selections where crew_id = p_crew;
  delete from crews.members where crew_id = p_crew;
  update crews.crews set status = 'dissolved', link_code = null where id = p_crew;
end $$;

create function crews.delete_crew(p_crew uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  if not exists (select 1 from crews.members where crew_id = p_crew and user_id = uid and role = 'owner') then
    perform private.fail('not_owner');
  end if;
  perform crews.dissolve(p_crew);
end $$;

create function crews.set_selected_crews(p_crew_ids uuid[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  delete from crews.selections where user_id = uid;
  insert into crews.selections (crew_id, user_id)
  select m.crew_id, uid
  from crews.members m
  join crews.crews c on c.id = m.crew_id and c.status = 'active'
  where m.user_id = uid and m.crew_id = any (coalesce(p_crew_ids, '{}'::uuid[]));
end $$;

create function crews.list_my_crews() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'avatar_path', c.avatar_path,
        'owner_id', c.owner_id,
        'role', me.role,
        'link_code', case when me.role = 'owner' then c.link_code else null end,
        'selected', exists (select 1 from crews.selections s where s.user_id = uid and s.crew_id = c.id),
        'members', (
          select jsonb_agg(
            jsonb_build_object(
              'user_id', p.id,
              'handle', p.handle,
              'avatar_path', p.avatar_path,
              'role', m.role,
              'live', exists (
                select 1 from live.sessions ls
                join live.session_crews sc on sc.session_id = ls.id and sc.crew_id = c.id
                where ls.user_id = p.id and ls.ended_at is null and ls.last_seen_at > private.stale_cutoff()
              )
            ) order by (m.role = 'owner') desc, p.handle)
          from crews.members m
          join accounts.profiles p on p.id = m.user_id and p.status = 'active'
          where m.crew_id = c.id
        )
      ) order by c.created_at)
    from crews.crews c
    join crews.members me on me.crew_id = c.id and me.user_id = uid
    where c.status = 'active'
  ), '[]'::jsonb);
end $$;

-- live ----------------------------------------------------------------------

create function live.start_session(p_crew_ids uuid[], p_platform text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  sid uuid;
  valid_ids uuid[];
begin
  select coalesce(array_agg(m.crew_id), '{}') into valid_ids
  from crews.members m
  join crews.crews c on c.id = m.crew_id and c.status = 'active'
  where m.user_id = uid and m.crew_id = any (coalesce(p_crew_ids, '{}'::uuid[]));
  if coalesce(array_length(valid_ids, 1), 0) = 0 then perform private.fail('not_a_member'); end if;
  update live.sessions set ended_at = coalesce(last_seen_at, now()) where user_id = uid and ended_at is null;
  insert into live.sessions (user_id, platform) values (uid, p_platform) returning id into sid;
  insert into live.session_crews (session_id, crew_id) select sid, unnest(valid_ids);
  return sid;
end $$;

-- Heartbeat and checkpoint in one call. Returns the Toronto-time week the checkpoint was written to.
create function live.checkpoint_session(p_session uuid, p_max_speed_kmh real default null, p_distance_m real default null)
returns date
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  wk date := private.current_week_start();
  speed real := greatest(coalesce(p_max_speed_kmh, 0), 0);
  dist real := greatest(coalesce(p_distance_m, 0), 0);
begin
  update live.sessions set last_seen_at = now()
  where id = p_session and user_id = uid and ended_at is null;
  if not found then perform private.fail('session_not_found'); end if;
  if p_max_speed_kmh is not null or p_distance_m is not null then
    insert into live.segments as s (session_id, week_start, max_speed_kmh, max_speed_at, distance_m, updated_at)
    values (p_session, wk, speed, case when speed > 0 then now() end, dist, now())
    on conflict (session_id, week_start) do update
      set max_speed_at = case when excluded.max_speed_kmh > s.max_speed_kmh then now() else s.max_speed_at end,
          max_speed_kmh = greatest(s.max_speed_kmh, excluded.max_speed_kmh),
          distance_m = greatest(s.distance_m, excluded.distance_m),
          updated_at = now();
  end if;
  return wk;
end $$;

create function live.end_session(p_session uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  update live.sessions set ended_at = now() where id = p_session and user_id = uid and ended_at is null;
end $$;

-- Marks sessions ended when they have gone quiet. Run every minute by pg_cron.
create function live.sweep_stale() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update live.sessions set ended_at = last_seen_at
  where ended_at is null and last_seen_at < private.stale_cutoff();
  get diagnostics n = row_count;
  return n;
end $$;

-- leaderboard ---------------------------------------------------------------

create function leaderboard.weekly_top_speed(p_crew uuid, p_week_start date default null)
returns table (rank integer, user_id uuid, handle text, avatar_path text, top_speed_kmh real, set_on date)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  wk date := coalesce(p_week_start, private.current_week_start());
begin
  if not private.is_crew_member(p_crew, uid) then perform private.fail('not_a_member'); end if;
  return query
    with best as (
      select distinct on (ses.user_id)
             ses.user_id as uid, seg.max_speed_kmh as speed, seg.max_speed_at as at
      from live.segments seg
      join live.sessions ses on ses.id = seg.session_id
      join live.session_crews sc on sc.session_id = ses.id and sc.crew_id = p_crew
      join crews.members m on m.crew_id = p_crew and m.user_id = ses.user_id
      where seg.week_start = wk and seg.max_speed_kmh > 0
      order by ses.user_id, seg.max_speed_kmh desc, seg.max_speed_at asc
    )
    select (rank() over (order by b.speed desc))::integer,
           p.id, p.handle, p.avatar_path, b.speed,
           (b.at at time zone private.setting('toronto_tz'))::date
    from best b
    join accounts.profiles p on p.id = b.uid and p.status = 'active'
    order by b.speed desc, b.at asc;
end $$;

-- Account lifecycle (service role) ------------------------------------------

-- Runs the data side of the deletion path. The caller then removes avatar files and the auth user.
-- Returns the avatar path so the file can be deleted.
create function accounts.delete_account_data(p_user uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  crew record;
  heir uuid;
  avatar text;
begin
  select avatar_path into avatar from accounts.profiles where id = p_user;

  -- 1. Owned crews: transfer to the longest-standing member, or dissolve.
  for crew in select id from crews.crews where owner_id = p_user and status = 'active' loop
    select user_id into heir from crews.members
    where crew_id = crew.id and user_id <> p_user
    order by joined_at asc limit 1;
    if heir is null then
      perform crews.dissolve(crew.id);
    else
      update crews.members set role = 'member' where crew_id = crew.id and user_id = p_user;
      update crews.members set role = 'owner' where crew_id = crew.id and user_id = heir;
      update crews.crews set owner_id = heir where id = crew.id;
    end if;
  end loop;

  -- 2. Invites: revoke active ones, keep the records.
  update referral.invites
  set status = 'revoked', revoked_by = coalesce(revoked_by, 'inviter'), revoked_at = now()
  where inviter_id = p_user and status = 'active';

  -- 3. Live data.
  delete from live.sessions where user_id = p_user;

  -- 4. Memberships and selections.
  delete from crews.selections where user_id = p_user;
  delete from crews.members where user_id = p_user;

  -- 5. Tombstone the profile so the referral chain holds.
  update accounts.profiles
  set status = 'deleted',
      handle = 'deleted_' || substr(replace(id::text, '-', ''), 1, 10),
      avatar_path = null
  where id = p_user;

  return avatar;
end $$;

-- Data side of a suspension. The caller bans the auth user.
create function accounts.suspend_user(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  crew record;
  heir uuid;
begin
  update accounts.profiles set status = 'suspended' where id = p_user and status = 'active';
  update referral.invites
  set status = 'revoked', revoked_by = 'suspension', revoked_at = now()
  where inviter_id = p_user and status = 'active';
  update live.sessions set ended_at = now() where user_id = p_user and ended_at is null;
  for crew in select id from crews.crews where owner_id = p_user and status = 'active' loop
    select cm.user_id into heir from crews.members cm
    join accounts.profiles ap on ap.id = cm.user_id and ap.status = 'active'
    where cm.crew_id = crew.id and cm.user_id <> p_user
    order by cm.joined_at asc limit 1;
    if heir is not null then
      update crews.members set role = 'member' where crew_id = crew.id and user_id = p_user;
      update crews.members set role = 'owner' where crew_id = crew.id and user_id = heir;
      update crews.crews set owner_id = heir where id = crew.id;
    end if;
  end loop;
end $$;

create function accounts.restore_user(p_user uuid) returns void
language sql security definer set search_path = ''
as $$ update accounts.profiles set status = 'active' where id = p_user and status = 'suspended' $$;

-- Removes accounts that never finished: unconfirmed for 24 hours, or an auth user with no profile for an hour.
create function accounts.cleanup_unconfirmed() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer := 0;
  r record;
begin
  for r in
    select u.id from auth.users u
    where u.email_confirmed_at is null and u.created_at < now() - interval '24 hours'
  loop
    delete from accounts.profiles where id = r.id and status = 'active'
      and not exists (select 1 from crews.members m where m.user_id = r.id);
    delete from auth.users where id = r.id;
    n := n + 1;
  end loop;
  for r in
    select u.id from auth.users u
    where u.created_at < now() - interval '1 hour'
      and not exists (select 1 from accounts.profiles p where p.id = u.id)
  loop
    delete from auth.users where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Keep-alive. Real database activity so a free project is not paused for inactivity.
create function public.ping() returns text
language sql stable security definer set search_path = ''
as $$ select 'ok'::text $$;
