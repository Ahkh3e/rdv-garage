-- Walkie-talkie voice (docs/features/walkie-talkie.md in the spec repo). No audio or talking state is stored.
-- Database side: who may publish, the per-crew voice switch, the private walkie:<room_id> channel, and the queue of
-- "remove this person from the audio service" calls that the walkie_kick Edge Function carries out.

create extension if not exists pg_net with schema extensions;

-- Where walkie_kick lives and the shared secret that proves the caller is the database. Empty means not configured:
-- kicks are queued but not sent, and the 5-minute token lifetime is the backstop. Set both per project (docs/SETUP.md).
insert into private.settings (key, value) values ('walkie_kick_url', ''), ('walkie_kick_secret', '') on conflict (key) do nothing;

-- Voice ---------------------------------------------------------------------------------

create function private.voice_revoked_crews(p_room uuid, p_user uuid) returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.crew_id
  from crews.members m
  where m.user_id = p_user and m.voice_revoked_at is not null
    and m.crew_id in (
      select r.crew_id from chat.rooms r where r.id = p_room and r.kind = 'crew'
      union
      select rc.crew_id from chat.rooms r join rdvs.crews rc on rc.rdv_id = r.rdv_id where r.id = p_room and r.kind = 'rdv'
    )
$$;

create function private.voice_allowed(p_room uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select not exists (select 1 from private.voice_revoked_crews(p_room, p_user)) $$;

-- Queue ------------------------------------------------------------------------------------

create table private.walkie_kicks (
  id bigserial primary key,
  room_id uuid not null,
  user_id uuid,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  request_id bigint,
  sent_at timestamptz
);
create index walkie_kicks_created_idx on private.walkie_kicks (created_at);
alter table private.walkie_kicks enable row level security;

-- One HTTP call per queued row, sent by pg_net after the surrounding transaction commits. The function is idempotent,
-- so a repeat is harmless.
create function private.walkie_send(p_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  k private.walkie_kicks%rowtype;
  target text := private.setting('walkie_kick_url');
  secret text := private.setting('walkie_kick_secret');
  req bigint;
begin
  select * into k from private.walkie_kicks where id = p_id;
  if k.id is null or coalesce(target, '') = '' or coalesce(secret, '') = '' then return; end if;
  select net.http_post(
    url := target,
    body := jsonb_build_object('room_id', k.room_id, 'user_id', k.user_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-walkie-secret', secret),
    timeout_milliseconds := 5000
  ) into req;
  update private.walkie_kicks set attempts = attempts + 1, request_id = req, sent_at = now() where id = p_id;
end $$;

-- user null removes everyone (room closed or deleted). Never fails the write that caused it.
create function private.walkie_kick(p_room uuid, p_user uuid default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare k bigint;
begin
  insert into private.walkie_kicks (room_id, user_id) values (p_room, p_user) returning id into k;
  perform private.walkie_send(k);
exception when others then
  null;
end $$;

-- Resends calls that got no success answer, and forgets rows once the 5-minute token backstop has passed.
create function private.walkie_retry() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  k private.walkie_kicks%rowtype;
  n integer := 0;
begin
  delete from private.walkie_kicks where created_at < now() - interval '10 minutes';
  delete from private.walkie_kicks q using net._http_response r where r.id = q.request_id and r.status_code between 200 and 299;
  for k in
    select * from private.walkie_kicks
    where attempts < 4 and (sent_at is null or sent_at < now() - interval '30 seconds')
  loop
    perform private.walkie_send(k.id);
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('rdv-walkie-kick-retry', '* * * * *', $$select private.walkie_retry()$$);

-- Triggers ----------------------------------------------------------------------------------

-- A member leaves, is removed, or is blocked from an RDV room. When the room itself is going, the room trigger covers it.
create function chat.on_member_gone() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not (new.blocked and not old.blocked) then return new; end if;
  if exists (select 1 from chat.rooms where id = old.room_id) then perform private.walkie_kick(old.room_id, old.user_id); end if;
  return coalesce(new, old);
end $$;
create trigger chat_member_removed after delete on chat.members for each row execute function chat.on_member_gone();
create trigger chat_member_blocked after update of blocked on chat.members for each row execute function chat.on_member_gone();

create function chat.on_room_deleted() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.walkie_kick(old.id, null);
  return old;
end $$;
create trigger chat_room_deleted after delete on chat.rooms for each row execute function chat.on_room_deleted();

create or replace function chat.close_finished_rdv_rooms() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  closing uuid[];
  rid uuid;
begin
  with closed as (
    update chat.rooms r set status = 'closed'
    from rdvs.rdvs d
    where r.kind = 'rdv' and r.status = 'active' and d.id = r.rdv_id
      and (d.status = 'cancelled' or private.rdv_end(d.starts_at, d.ends_at) <= now())
    returning r.id
  )
  select coalesce(array_agg(id), '{}') into closing from closed;
  foreach rid in array closing loop
    perform private.walkie_kick(rid, null);
  end loop;
  return coalesce(array_length(closing, 1), 0);
end $$;

-- set_voice_access ----------------------------------------------------------------------------

create function crews.set_voice_access(p_crew uuid, p_user uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  caller text;
  target text;
  rid uuid;
begin
  select role into caller from crews.members where crew_id = p_crew and user_id = uid;
  if caller is null or caller = 'member' then perform private.fail('not_moderator'); end if;
  select role into target from crews.members where crew_id = p_crew and user_id = p_user;
  if target is null then perform private.fail('not_a_member'); end if;
  if caller = 'admin' and target <> 'member' and p_user <> uid then perform private.fail('cannot_moderate_admin'); end if;
  if p_allowed then
    update crews.members set voice_revoked_at = null, voice_revoked_by = null where crew_id = p_crew and user_id = p_user;
  else
    update crews.members set voice_revoked_at = now(), voice_revoked_by = uid where crew_id = p_crew and user_id = p_user;
  end if;
  for rid in
    select m.room_id from chat.members m join chat.rooms r on r.id = m.room_id
    where m.user_id = p_user and not m.blocked and r.status = 'active'
      and (r.crew_id = p_crew or r.rdv_id in (select rc.rdv_id from rdvs.crews rc where rc.crew_id = p_crew))
  loop
    perform private.walkie_kick(rid, p_user);
  end loop;
end $$;

-- The member list shows whether voice is off, to moderators and to the person themselves.
create or replace function crews.list_my_crews() returns jsonb
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
              'car_icon', p.car_icon,
              'role', m.role,
              'voice_off', (me.role in ('owner', 'admin') or m.user_id = uid) and m.voice_revoked_at is not null,
              'live', exists (
                select 1 from live.sessions ls
                join live.session_crews sc on sc.session_id = ls.id and sc.crew_id = c.id
                where ls.user_id = p.id and ls.ended_at is null and ls.last_seen_at > private.stale_cutoff()
              )
            ) order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, p.handle)
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

-- Token minting ---------------------------------------------------------------------------------

-- Called by walkie_token with the service role. state is ok or the error code to return.
create function chat.walkie_access(p_room uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  r chat.rooms%rowtype;
  names text[];
begin
  select * into r from chat.rooms where id = p_room;
  if r.id is null then return jsonb_build_object('state', 'room_not_found'); end if;
  if not private.is_active(p_user) then return jsonb_build_object('state', 'suspended'); end if;
  if not private.chat_is_member(p_room, p_user) then return jsonb_build_object('state', 'not_room_member'); end if;
  if r.status = 'closed' then return jsonb_build_object('state', 'room_closed'); end if;
  select coalesce(array_agg(c.name order by c.name), '{}') into names
  from private.voice_revoked_crews(p_room, p_user) v join crews.crews c on c.id = v;
  return jsonb_build_object('state', 'ok', 'can_publish', coalesce(array_length(names, 1), 0) = 0, 'voice_off_crews', to_jsonb(names));
end $$;

-- Realtime: walkie:<room_id> -------------------------------------------------------------------------

create function private.walkie_topic_room(p_topic text) returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  if p_topic like 'walkie:%' then return substr(p_topic, 8)::uuid; end if;
  return null;
exception when others then
  return null;
end $$;

create function private.can_use_walkie_topic(p_topic text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    private.chat_is_member(private.walkie_topic_room(p_topic), auth.uid())
    and exists (select 1 from chat.rooms r where r.id = private.walkie_topic_room(p_topic) and r.status = 'active'),
    false)
$$;

create policy walkie_channel_receive on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and private.can_use_walkie_topic((select realtime.topic())));
create policy walkie_channel_send on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and private.can_use_walkie_topic((select realtime.topic())));

-- Grants --------------------------------------------------------------------------------------------

revoke execute on function
  private.voice_revoked_crews(uuid, uuid), private.voice_allowed(uuid, uuid), private.walkie_send(bigint),
  private.walkie_kick(uuid, uuid), private.walkie_retry(), private.walkie_topic_room(text), private.can_use_walkie_topic(text),
  chat.walkie_access(uuid, uuid), crews.set_voice_access(uuid, uuid, boolean)
  from public;
grant execute on function
  private.voice_revoked_crews(uuid, uuid), private.voice_allowed(uuid, uuid), private.walkie_send(bigint),
  private.walkie_kick(uuid, uuid), private.walkie_retry(), private.walkie_topic_room(text), private.can_use_walkie_topic(text),
  chat.walkie_access(uuid, uuid), crews.set_voice_access(uuid, uuid, boolean)
  to service_role;
grant execute on function private.walkie_topic_room(text), private.can_use_walkie_topic(text) to authenticated;
grant execute on function crews.set_voice_access(uuid, uuid, boolean) to authenticated;
grant all on private.walkie_kicks to service_role;
grant usage, select on sequence private.walkie_kicks_id_seq to service_role;
