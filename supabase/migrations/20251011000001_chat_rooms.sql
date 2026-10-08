-- Chat rooms: a standing room per crew, invite-only rooms, and RDV rooms (docs/features/chat-rooms.md in the spec repo).
-- Text only. Messages are readable only by members of the room, only from the time they joined, and only while kept.
-- Live delivery uses one private Realtime channel per person, inbox:<user_id>. There are no tables for voice.

create schema if not exists chat;

insert into private.settings (key, value) values ('chat_message_ttl_days', '7') on conflict (key) do nothing;

create table chat.rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('crew', 'invite', 'rdv')),
  name text not null check (char_length(name) between 1 and 60),
  description text check (description is null or char_length(description) <= 140),
  crew_id uuid unique references crews.crews (id) on delete cascade,
  rdv_id uuid unique references rdvs.rdvs (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  constraint rooms_kind_ref check (
    (kind = 'crew' and crew_id is not null and rdv_id is null)
    or (kind = 'rdv' and rdv_id is not null and crew_id is null)
    or (kind = 'invite' and crew_id is null and rdv_id is null)
  )
);

create table chat.members (
  room_id uuid not null references chat.rooms (id) on delete cascade,
  user_id uuid not null references accounts.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  muted boolean not null default false,
  last_read_at timestamptz not null default now(),
  blocked boolean not null default false,
  primary key (room_id, user_id)
);
create index chat_members_user_idx on chat.members (user_id);
create unique index chat_members_one_owner on chat.members (room_id) where role = 'owner';

create table chat.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references chat.rooms (id) on delete cascade,
  sender_id uuid not null references accounts.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index chat_messages_room_idx on chat.messages (room_id, created_at desc);
create index chat_messages_created_idx on chat.messages (created_at);
create index chat_messages_sender_idx on chat.messages (sender_id);

-- Helpers -------------------------------------------------------------------

create function private.chat_ttl() returns interval
language sql stable security definer set search_path = ''
as $$ select make_interval(days => private.setting('chat_message_ttl_days')::integer) $$;

create function private.chat_is_member(p_room uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_active(p_user)
    and exists (select 1 from chat.members m where m.room_id = p_room and m.user_id = p_user and not m.blocked)
$$;

create function private.chat_can_read(p_room uuid, p_user uuid, p_created timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_active(p_user)
    and p_created > now() - private.chat_ttl()
    and exists (
      select 1 from chat.members m
      where m.room_id = p_room and m.user_id = p_user and not m.blocked and p_created >= m.joined_at
    )
$$;

-- Owner of an invite room, owner or admin of the crew for a crew room, the host or an owner or admin of one of the
-- RDV's crews for an RDV room.
create function private.chat_moderator(p_room uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_active(p_user) and coalesce((
    select case r.kind
      when 'crew' then private.is_crew_moderator(r.crew_id, p_user)
      when 'invite' then exists (select 1 from chat.members m where m.room_id = r.id and m.user_id = p_user and m.role = 'owner')
      else exists (
        select 1 from rdvs.rdvs d
        where d.id = r.rdv_id
          and (
            d.host_id = p_user
            or exists (
              select 1 from rdvs.crews rc
              join crews.crews c on c.id = rc.crew_id and c.status = 'active'
              where rc.rdv_id = d.id and private.is_crew_moderator(rc.crew_id, p_user)
            )
          )
      )
    end
    from chat.rooms r where r.id = p_room
  ), false)
$$;

-- Two people in the same invite room or RDV room see each other's handle, avatar and car icon, and nothing more.
create function private.chat_shares_room(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from chat.members x
    join chat.members y on y.room_id = x.room_id
    join chat.rooms r on r.id = x.room_id
    where x.user_id = p_a and y.user_id = p_b and not x.blocked and not y.blocked and r.kind in ('invite', 'rdv')
  )
$$;

-- Delivery to a person's inbox must never fail the write that caused it.
create function private.chat_notify(p_user uuid, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, 'inbox:' || p_user::text, true);
exception when others then
  null;
end $$;

create function private.chat_add_member(p_room uuid, p_user uuid, p_role text default 'member', p_joined timestamptz default now()) returns void
language sql security definer set search_path = ''
as $$
  insert into chat.members (room_id, user_id, role, joined_at, last_read_at)
  values (p_room, p_user, p_role, p_joined, p_joined)
  on conflict (room_id, user_id) do nothing
$$;

-- Keeping rooms in step with crews and RSVPs ------------------------------------

create function chat.on_crew_created() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into chat.rooms (kind, name, crew_id) values ('crew', new.name, new.id);
  return new;
end $$;
create trigger chat_crew_created after insert on crews.crews for each row execute function chat.on_crew_created();

create function chat.on_crew_member_added() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.chat_add_member(r.id, new.user_id, 'member', now()) from chat.rooms r where r.crew_id = new.crew_id;
  perform private.chat_add_member(r.id, new.user_id, 'member', now())
  from chat.rooms r
  join rdvs.crews rc on rc.rdv_id = r.rdv_id and rc.crew_id = new.crew_id
  join rdvs.rsvps s on s.rdv_id = r.rdv_id and s.user_id = new.user_id and s.answer in ('going', 'maybe')
  where r.status = 'active';
  return new;
end $$;
create trigger chat_crew_member_added after insert on crews.members for each row execute function chat.on_crew_member_added();

create function chat.on_crew_member_removed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from chat.members m using chat.rooms r
  where m.room_id = r.id and m.user_id = old.user_id and r.crew_id = old.crew_id;
  delete from chat.members m using chat.rooms r, rdvs.crews rc
  where m.room_id = r.id and r.rdv_id = rc.rdv_id and rc.crew_id = old.crew_id
    and m.user_id = old.user_id and not m.blocked
    and not private.in_rdv_crews(r.rdv_id, old.user_id);
  return old;
end $$;
create trigger chat_crew_member_removed after delete on crews.members for each row execute function chat.on_crew_member_removed();

create function chat.on_rsvp_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  room record;
begin
  if tg_op = 'DELETE' then
    delete from chat.members m using chat.rooms r
    where m.room_id = r.id and r.rdv_id = old.rdv_id and m.user_id = old.user_id and not m.blocked
      and not exists (select 1 from rdvs.rdvs d where d.id = old.rdv_id and d.host_id = old.user_id);
    return old;
  end if;
  select id, status into room from chat.rooms where rdv_id = new.rdv_id;
  if room.id is null then return new; end if;
  if new.answer in ('going', 'maybe') then
    if room.status = 'active' and private.in_rdv_crews(new.rdv_id, new.user_id) then
      perform private.chat_add_member(room.id, new.user_id, 'member', now());
    end if;
  else
    delete from chat.members m
    where m.room_id = room.id and m.user_id = new.user_id and not m.blocked
      and not exists (select 1 from rdvs.rdvs d where d.id = new.rdv_id and d.host_id = new.user_id);
  end if;
  return new;
end $$;
create trigger chat_rsvp_changed after insert or update of answer or delete on rdvs.rsvps for each row execute function chat.on_rsvp_changed();

-- Every existing crew gets its standing room.
insert into chat.rooms (kind, name, crew_id, created_at)
select 'crew', c.name, c.id, c.created_at from crews.crews c where c.status = 'active';
insert into chat.members (room_id, user_id, joined_at, last_read_at)
select r.id, m.user_id, m.joined_at, m.joined_at from chat.rooms r join crews.members m on m.crew_id = r.crew_id where r.kind = 'crew';

-- Deleting a crew deletes its room, members and messages.
create or replace function crews.dissolve(p_crew uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from chat.rooms where crew_id = p_crew;
  delete from live.session_crews where crew_id = p_crew;
  delete from crews.selections where crew_id = p_crew;
  delete from crews.members where crew_id = p_crew;
  update crews.crews set status = 'dissolved', link_code = null where id = p_crew;
end $$;

-- Access policies ----------------------------------------------------------------

alter table chat.rooms enable row level security;
alter table chat.members enable row level security;
alter table chat.messages enable row level security;

create policy chat_rooms_read on chat.rooms for select to authenticated
  using (
    private.chat_is_member(id, auth.uid())
    or (kind = 'crew' and private.is_crew_member(crew_id, auth.uid()))
  );

create policy chat_members_read on chat.members for select to authenticated
  using (not blocked and private.chat_is_member(room_id, auth.uid()));

create policy chat_messages_read on chat.messages for select to authenticated
  using (private.chat_can_read(room_id, auth.uid(), created_at));

-- Only the owner of the topic can join inbox:<user_id>, and only to receive; sending goes through send_message.
create policy inbox_channel_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'inbox:' || auth.uid()::text
    and private.is_active(auth.uid())
  );

-- A person's profile is also visible to members of an invite room or RDV room they share.
drop policy profiles_read on accounts.profiles;
create policy profiles_read on accounts.profiles for select to authenticated
  using (
    private.is_active(auth.uid())
    and (
      id = auth.uid()
      or (status = 'active' and (private.shares_crew(auth.uid(), id) or private.chat_shares_room(auth.uid(), id)))
    )
  );

drop policy avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and private.is_active(auth.uid())
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.shares_crew(auth.uid(), ((storage.foldername(name))[1])::uuid)
      or private.chat_shares_room(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  );

-- Functions ---------------------------------------------------------------------

create function chat.create_room(p_name text, p_description text default null, p_member_ids uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  room uuid;
  other uuid;
  others uuid[];
begin
  p_name := trim(coalesce(p_name, ''));
  if char_length(p_name) < 3 or char_length(p_name) > 30 then perform private.fail('room_name_invalid'); end if;
  p_description := nullif(trim(coalesce(p_description, '')), '');
  if p_description is not null and char_length(p_description) > 140 then perform private.fail('room_description_invalid'); end if;
  perform private.hit_rate_limit('create_room:' || uid::text, 20, 3600);
  others := array(select distinct x from unnest(coalesce(p_member_ids, '{}')) x where x <> uid);
  foreach other in array others loop
    if not private.is_active(other) or not private.shares_crew(uid, other) then perform private.fail('no_shared_crew'); end if;
  end loop;
  insert into chat.rooms (kind, name, description) values ('invite', p_name, p_description) returning id into room;
  perform private.chat_add_member(room, uid, 'owner');
  foreach other in array others loop
    perform private.chat_add_member(room, other);
    perform private.chat_notify(other, 'room_changed', jsonb_build_object('room_id', room));
  end loop;
  return room;
end $$;

create function chat.list_rooms() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  ttl interval := private.chat_ttl();
begin
  return coalesce((
    select jsonb_agg(x.j order by (x.kind = 'crew') desc, x.activity desc, x.created_at desc)
    from (
      select
        r.kind, r.created_at, coalesce(lm.created_at, r.created_at) as activity,
        jsonb_build_object(
          'id', r.id,
          'kind', r.kind,
          'name', coalesce(case r.kind when 'crew' then c.name when 'rdv' then d.title else r.name end, r.name),
          'description', r.description,
          'crew_id', r.crew_id,
          'rdv_id', r.rdv_id,
          'status', r.status,
          'role', m.role,
          'muted', m.muted,
          'can_moderate', private.chat_moderator(r.id, uid),
          'members', (select count(*) from chat.members mm where mm.room_id = r.id and not mm.blocked),
          'unread', (
            select count(*) from chat.messages u
            where u.room_id = r.id and u.sender_id <> uid
              and u.created_at > greatest(m.last_read_at, m.joined_at) and u.created_at > now() - ttl
          ),
          'last_message', case when lm.id is null then null else jsonb_build_object(
            'id', lm.id, 'sender_id', lm.sender_id, 'handle', lp.handle, 'body', lm.body, 'created_at', lm.created_at
          ) end
        ) as j
      from chat.members m
      join chat.rooms r on r.id = m.room_id
      left join crews.crews c on c.id = r.crew_id
      left join rdvs.rdvs d on d.id = r.rdv_id
      left join lateral (
        select ms.id, ms.sender_id, ms.body, ms.created_at from chat.messages ms
        where ms.room_id = r.id and ms.created_at >= m.joined_at and ms.created_at > now() - ttl
        order by ms.created_at desc limit 1
      ) lm on true
      left join accounts.profiles lp on lp.id = lm.sender_id
      where m.user_id = uid and not m.blocked and (r.status = 'active' or lm.id is not null)
    ) x
  ), '[]'::jsonb);
end $$;

create function chat.list_room_members(p_room uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r chat.rooms%rowtype;
  host uuid;
begin
  select * into r from chat.rooms where id = p_room;
  if r.id is null then perform private.fail('room_not_found'); end if;
  if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
  if r.kind = 'rdv' then select host_id into host from rdvs.rdvs where id = r.rdv_id; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'handle', p.handle,
      'avatar_path', p.avatar_path,
      'car_icon', p.car_icon,
      'role', case r.kind
        when 'crew' then coalesce((select cm.role from crews.members cm where cm.crew_id = r.crew_id and cm.user_id = m.user_id), 'member')
        when 'rdv' then case when m.user_id = host then 'host' else 'member' end
        else m.role
      end
    ) order by m.joined_at, m.user_id)
    from chat.members m
    join accounts.profiles p on p.id = m.user_id and p.status = 'active'
    where m.room_id = p_room and not m.blocked
  ), '[]'::jsonb);
end $$;

create function chat.send_message(p_room uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r chat.rooms%rowtype;
  msg chat.messages%rowtype;
  handle text;
  rcpt uuid;
begin
  select * into r from chat.rooms where id = p_room;
  if r.id is null then perform private.fail('room_not_found'); end if;
  if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
  if r.status = 'closed' then perform private.fail('room_closed'); end if;
  if p_body is null or char_length(p_body) > 1000 or btrim(p_body) = '' then perform private.fail('message_invalid'); end if;
  perform private.hit_rate_limit('send_message:' || uid::text, 30, 60);
  insert into chat.messages (room_id, sender_id, body) values (p_room, uid, p_body) returning * into msg;
  select p.handle into handle from accounts.profiles p where p.id = uid;
  for rcpt in
    select m.user_id from chat.members m where m.room_id = p_room and not m.blocked and private.is_active(m.user_id)
  loop
    perform private.chat_notify(rcpt, 'message', jsonb_build_object(
      'room_id', p_room, 'message_id', msg.id, 'sender_id', uid, 'handle', handle, 'text', msg.body, 'created_at', msg.created_at
    ));
  end loop;
  return jsonb_build_object('id', msg.id, 'room_id', p_room, 'sender_id', uid, 'handle', handle, 'body', msg.body, 'created_at', msg.created_at);
end $$;

create function chat.list_messages(p_room uuid, p_before timestamptz default null, p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  joined timestamptz;
  ttl interval := private.chat_ttl();
begin
  if not exists (select 1 from chat.rooms where id = p_room) then perform private.fail('room_not_found'); end if;
  select m.joined_at into joined from chat.members m where m.room_id = p_room and m.user_id = uid and not m.blocked;
  if joined is null then perform private.fail('not_room_member'); end if;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'sender_id', t.sender_id, 'handle', p.handle, 'avatar_path', p.avatar_path, 'car_icon', p.car_icon,
      'body', t.body, 'created_at', t.created_at
    ) order by t.created_at desc)
    from (
      select ms.* from chat.messages ms
      where ms.room_id = p_room and ms.created_at >= joined and ms.created_at > now() - ttl
        and (p_before is null or ms.created_at < p_before)
      order by ms.created_at desc limit p_limit
    ) t
    join accounts.profiles p on p.id = t.sender_id
  ), '[]'::jsonb);
end $$;

create function chat.delete_message(p_message uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  msg chat.messages%rowtype;
  room_kind text;
  rcpt uuid;
begin
  select * into msg from chat.messages where id = p_message;
  if msg.id is null then perform private.fail('message_not_found'); end if;
  if msg.sender_id <> uid and not private.chat_moderator(msg.room_id, uid) then
    if not private.chat_is_member(msg.room_id, uid) then perform private.fail('message_not_found'); end if;
    select r.kind into room_kind from chat.rooms r where r.id = msg.room_id;
    perform private.fail(case when room_kind = 'invite' then 'not_room_owner' else 'not_moderator' end);
  end if;
  delete from chat.messages where id = p_message;
  for rcpt in select m.user_id from chat.members m where m.room_id = msg.room_id and not m.blocked loop
    perform private.chat_notify(rcpt, 'message_deleted', jsonb_build_object('room_id', msg.room_id, 'message_id', p_message));
  end loop;
end $$;

create function chat.add_room_member(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r chat.rooms%rowtype;
begin
  select * into r from chat.rooms where id = p_room;
  if r.id is null then perform private.fail('room_not_found'); end if;
  if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
  if r.kind <> 'invite' then perform private.fail('room_fixed'); end if;
  if not private.chat_moderator(p_room, uid) then perform private.fail('not_room_owner'); end if;
  if p_user is null or not private.is_active(p_user) or not private.shares_crew(uid, p_user) then perform private.fail('no_shared_crew'); end if;
  perform private.chat_add_member(p_room, p_user);
  perform private.chat_notify(p_user, 'room_changed', jsonb_build_object('room_id', p_room));
end $$;

create function chat.remove_room_member(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r chat.rooms%rowtype;
  host uuid;
begin
  select * into r from chat.rooms where id = p_room;
  if r.id is null then perform private.fail('room_not_found'); end if;
  if r.kind = 'crew' then
    if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
    perform private.fail('room_fixed');
  end if;
  if r.kind = 'invite' then
    if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
    if not private.chat_moderator(p_room, uid) then perform private.fail('not_room_owner'); end if;
    if p_user = uid then perform private.fail('owner_must_transfer'); end if;
    delete from chat.members where room_id = p_room and user_id = p_user;
    if not found then perform private.fail('not_room_member'); end if;
  else
    if not private.chat_moderator(p_room, uid) then
      if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
      perform private.fail('not_moderator');
    end if;
    select d.host_id into host from rdvs.rdvs d where d.id = r.rdv_id;
    if p_user = host then perform private.fail('cannot_moderate_host'); end if;
    update chat.members set blocked = true where room_id = p_room and user_id = p_user and not blocked;
    if not found then perform private.fail('not_room_member'); end if;
  end if;
  perform private.chat_notify(p_user, 'room_changed', jsonb_build_object('room_id', p_room));
end $$;

create function chat.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r chat.rooms%rowtype;
  mine text;
begin
  select * into r from chat.rooms where id = p_room;
  if r.id is null then perform private.fail('room_not_found'); end if;
  select m.role into mine from chat.members m where m.room_id = p_room and m.user_id = uid and not m.blocked;
  if mine is null then perform private.fail('not_room_member'); end if;
  if r.kind <> 'invite' then perform private.fail('room_fixed'); end if;
  if mine = 'owner' then perform private.fail('owner_must_transfer'); end if;
  delete from chat.members where room_id = p_room and user_id = uid;
end $$;

create function chat.delete_room(p_room uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r chat.rooms%rowtype;
  rcpt uuid;
begin
  select * into r from chat.rooms where id = p_room;
  if r.id is null then perform private.fail('room_not_found'); end if;
  if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
  if r.kind <> 'invite' then perform private.fail('room_fixed'); end if;
  if not private.chat_moderator(p_room, uid) then perform private.fail('not_room_owner'); end if;
  for rcpt in select m.user_id from chat.members m where m.room_id = p_room loop
    perform private.chat_notify(rcpt, 'room_changed', jsonb_build_object('room_id', p_room));
  end loop;
  delete from chat.rooms where id = p_room;
end $$;

create function chat.transfer_room(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r chat.rooms%rowtype;
begin
  select * into r from chat.rooms where id = p_room;
  if r.id is null then perform private.fail('room_not_found'); end if;
  if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
  if r.kind <> 'invite' then perform private.fail('room_fixed'); end if;
  if not private.chat_moderator(p_room, uid) then perform private.fail('not_room_owner'); end if;
  if p_user = uid or not private.chat_is_member(p_room, p_user) then perform private.fail('not_room_member'); end if;
  update chat.members set role = 'member' where room_id = p_room and user_id = uid;
  update chat.members set role = 'owner' where room_id = p_room and user_id = p_user;
  perform private.chat_notify(p_user, 'room_changed', jsonb_build_object('room_id', p_room));
end $$;

create function chat.mark_read(p_room uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  if not exists (select 1 from chat.rooms where id = p_room) then perform private.fail('room_not_found'); end if;
  update chat.members set last_read_at = greatest(last_read_at, clock_timestamp())
  where room_id = p_room and user_id = uid and not blocked;
  if not found then perform private.fail('not_room_member'); end if;
end $$;

create function chat.set_room_muted(p_room uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  if not exists (select 1 from chat.rooms where id = p_room) then perform private.fail('room_not_found'); end if;
  update chat.members set muted = coalesce(p_muted, false) where room_id = p_room and user_id = uid and not blocked;
  if not found then perform private.fail('not_room_member'); end if;
end $$;

-- Host only, until the RDV ends. Opening it again returns the same room.
create function chat.open_rdv_room(p_rdv uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  d rdvs.rdvs%rowtype;
  room uuid;
begin
  select * into d from rdvs.rdvs where id = p_rdv;
  if d.id is null or not private.can_see_rdv(p_rdv, uid) then perform private.fail('rdv_not_found'); end if;
  if d.host_id is distinct from uid then perform private.fail('not_host'); end if;
  if d.status <> 'scheduled' or private.rdv_end(d.starts_at, d.ends_at) <= now() then perform private.fail('rdv_closed'); end if;
  select id into room from chat.rooms where rdv_id = p_rdv;
  if room is not null then return room; end if;
  insert into chat.rooms (kind, name, rdv_id) values ('rdv', d.title, p_rdv) returning id into room;
  perform private.chat_add_member(room, uid);
  perform private.chat_add_member(room, s.user_id)
  from rdvs.rsvps s
  where s.rdv_id = p_rdv and s.answer in ('going', 'maybe') and private.is_active(s.user_id) and private.in_rdv_crews(p_rdv, s.user_id);
  return room;
end $$;

-- Scheduled jobs --------------------------------------------------------------------

create function chat.expire_messages() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from chat.messages where created_at < now() - private.chat_ttl();
  get diagnostics n = row_count;
  delete from chat.rooms r
  where r.kind = 'rdv' and r.status = 'closed' and not exists (select 1 from chat.messages m where m.room_id = r.id);
  return n;
end $$;
select cron.schedule('rdv-expire-chat-messages', '*/10 * * * *', $$select chat.expire_messages()$$);

-- A closed room stays readable until its messages expire. The walkie work extends this function to also remove
-- anyone still connected to the room's voice channel.
create function chat.close_finished_rdv_rooms() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update chat.rooms r set status = 'closed'
  from rdvs.rdvs d
  where r.kind = 'rdv' and r.status = 'active' and d.id = r.rdv_id
    and (d.status = 'cancelled' or private.rdv_end(d.starts_at, d.ends_at) <= now());
  get diagnostics n = row_count;
  return n;
end $$;
select cron.schedule('rdv-close-rdv-rooms', '* * * * *', $$select chat.close_finished_rdv_rooms()$$);

-- Account deletion ---------------------------------------------------------------------
-- The person's messages and memberships go. An invite room they own passes to its longest-standing member, or is
-- deleted if it has none.
create or replace function accounts.delete_account_data(p_user uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  crew record;
  room record;
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

  -- 3. RDVs: hosted ones not yet ended are cancelled and keep their rows with the host cleared; the person's answers
  -- and arrivals are removed, and other members' arrivals stay.
  update rdvs.rdvs
  set status = 'cancelled', updated_at = now()
  where host_id = p_user and status = 'scheduled' and private.rdv_end(starts_at, ends_at) > now();
  update rdvs.rdvs set host_id = null where host_id = p_user;
  delete from rdvs.rsvps where user_id = p_user;
  delete from rdvs.arrivals where user_id = p_user;

  -- 4. Live data.
  delete from live.sessions where user_id = p_user;

  -- 5. Pins dropped by the person.
  delete from places.pins where dropper_id = p_user;

  -- 6. Chat: messages, owned invite rooms, memberships.
  delete from chat.messages where sender_id = p_user;
  for room in select m.room_id as id from chat.members m join chat.rooms r on r.id = m.room_id
    where m.user_id = p_user and m.role = 'owner' and r.kind = 'invite' loop
    select user_id into heir from chat.members
    where room_id = room.id and user_id <> p_user and not blocked
    order by joined_at asc, user_id limit 1;
    if heir is null then
      delete from chat.rooms where id = room.id;
    else
      update chat.members set role = 'member' where room_id = room.id and user_id = p_user;
      update chat.members set role = 'owner' where room_id = room.id and user_id = heir;
    end if;
  end loop;
  delete from chat.members where user_id = p_user;

  -- 7. Memberships and selections.
  delete from crews.selections where user_id = p_user;
  delete from crews.members where user_id = p_user;

  -- 8. Tombstone the profile so the referral chain holds.
  update accounts.profiles
  set status = 'deleted',
      handle = 'deleted_' || substr(replace(id::text, '-', ''), 1, 10),
      avatar_path = null
  where id = p_user;

  return avatar;
end $$;

-- Terms -------------------------------------------------------------------------------
-- Chat and voice change the disclaimers, so everyone accepts the new version on their next open.
update private.settings set value = 'v2' where key = 'terms_version';

create function accounts.accept_terms(p_version text) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  if p_version is distinct from private.setting('terms_version') then perform private.fail('terms_required'); end if;
  update accounts.profiles set terms_version = p_version, terms_accepted_at = now() where id = uid;
end $$;

-- Grants -------------------------------------------------------------------------------

revoke execute on function
  private.chat_ttl(), private.chat_is_member(uuid, uuid), private.chat_can_read(uuid, uuid, timestamptz),
  private.chat_moderator(uuid, uuid), private.chat_shares_room(uuid, uuid), private.chat_notify(uuid, text, jsonb),
  private.chat_add_member(uuid, uuid, text, timestamptz)
  from public;
grant execute on function
  private.chat_is_member(uuid, uuid), private.chat_can_read(uuid, uuid, timestamptz), private.chat_shares_room(uuid, uuid),
  private.chat_ttl()
  to authenticated;
grant execute on function
  private.chat_ttl(), private.chat_is_member(uuid, uuid), private.chat_can_read(uuid, uuid, timestamptz),
  private.chat_moderator(uuid, uuid), private.chat_shares_room(uuid, uuid), private.chat_notify(uuid, text, jsonb),
  private.chat_add_member(uuid, uuid, text, timestamptz)
  to service_role;

revoke all on all tables in schema chat from public, anon, authenticated;
grant usage on schema chat to anon, authenticated, service_role;
grant select on chat.rooms, chat.messages to authenticated;
grant select (room_id, user_id, role, joined_at) on chat.members to authenticated;
grant all on all tables in schema chat to service_role;

revoke execute on all functions in schema chat from public;
grant execute on function
  chat.create_room(text, text, uuid[]), chat.list_rooms(), chat.list_room_members(uuid), chat.send_message(uuid, text),
  chat.list_messages(uuid, timestamptz, integer), chat.delete_message(uuid), chat.add_room_member(uuid, uuid),
  chat.remove_room_member(uuid, uuid), chat.leave_room(uuid), chat.delete_room(uuid), chat.transfer_room(uuid, uuid),
  chat.mark_read(uuid), chat.set_room_muted(uuid, boolean), chat.open_rdv_room(uuid)
  to authenticated;
grant execute on all functions in schema chat to service_role;

revoke execute on function accounts.accept_terms(text) from public;
grant execute on function accounts.accept_terms(text) to authenticated, service_role;
