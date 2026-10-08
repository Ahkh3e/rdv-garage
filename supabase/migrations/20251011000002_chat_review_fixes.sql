-- Chat review fixes: terms enforced on the server, sender avatar and car icon in live messages, one RDV room per RDV under concurrency.

-- Synthetic profiles (operator toolkit, tests) are exempt.
create function private.chat_require_terms(p_user uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  p accounts.profiles%rowtype;
begin
  select * into p from accounts.profiles where id = p_user;
  if p.id is null or p.is_synthetic then return; end if;
  if p.terms_version is distinct from private.setting('terms_version') then perform private.fail('terms_required'); end if;
end $$;

revoke execute on function private.chat_require_terms(uuid) from public;
grant execute on function private.chat_require_terms(uuid) to service_role;

create or replace function chat.create_room(p_name text, p_description text default null, p_member_ids uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  room uuid;
  other uuid;
  others uuid[];
begin
  perform private.chat_require_terms(uid);
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

create or replace function chat.send_message(p_room uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r chat.rooms%rowtype;
  msg chat.messages%rowtype;
  sender accounts.profiles%rowtype;
  rcpt uuid;
begin
  perform private.chat_require_terms(uid);
  select * into r from chat.rooms where id = p_room;
  if r.id is null then perform private.fail('room_not_found'); end if;
  if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
  if r.status = 'closed' then perform private.fail('room_closed'); end if;
  if p_body is null or char_length(p_body) > 1000 or btrim(p_body) = '' then perform private.fail('message_invalid'); end if;
  perform private.hit_rate_limit('send_message:' || uid::text, 30, 60);
  insert into chat.messages (room_id, sender_id, body) values (p_room, uid, p_body) returning * into msg;
  select * into sender from accounts.profiles where id = uid;
  for rcpt in
    select m.user_id from chat.members m where m.room_id = p_room and not m.blocked and private.is_active(m.user_id)
  loop
    perform private.chat_notify(rcpt, 'message', jsonb_build_object(
      'room_id', p_room, 'message_id', msg.id, 'sender_id', uid, 'handle', sender.handle, 'text', msg.body, 'created_at', msg.created_at,
      'avatar_path', sender.avatar_path, 'car_icon', sender.car_icon
    ));
  end loop;
  return jsonb_build_object('id', msg.id, 'room_id', p_room, 'sender_id', uid, 'handle', sender.handle, 'body', msg.body, 'created_at', msg.created_at);
end $$;

create or replace function chat.add_room_member(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r chat.rooms%rowtype;
begin
  perform private.chat_require_terms(uid);
  select * into r from chat.rooms where id = p_room;
  if r.id is null then perform private.fail('room_not_found'); end if;
  if not private.chat_is_member(p_room, uid) then perform private.fail('not_room_member'); end if;
  if r.kind <> 'invite' then perform private.fail('room_fixed'); end if;
  if not private.chat_moderator(p_room, uid) then perform private.fail('not_room_owner'); end if;
  if p_user is null or not private.is_active(p_user) or not private.shares_crew(uid, p_user) then perform private.fail('no_shared_crew'); end if;
  perform private.chat_add_member(p_room, p_user);
  perform private.chat_notify(p_user, 'room_changed', jsonb_build_object('room_id', p_room));
end $$;

-- The unique rdv_id makes concurrent opens converge on one room. chat_add_member never touches an existing row, so blocked members stay blocked.
create or replace function chat.open_rdv_room(p_rdv uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  d rdvs.rdvs%rowtype;
  room uuid;
begin
  perform private.chat_require_terms(uid);
  select * into d from rdvs.rdvs where id = p_rdv;
  if d.id is null or not private.can_see_rdv(p_rdv, uid) then perform private.fail('rdv_not_found'); end if;
  if d.host_id is distinct from uid then perform private.fail('not_host'); end if;
  if d.status <> 'scheduled' or private.rdv_end(d.starts_at, d.ends_at) <= now() then perform private.fail('rdv_closed'); end if;
  insert into chat.rooms (kind, name, rdv_id) values ('rdv', d.title, p_rdv) on conflict (rdv_id) do nothing returning id into room;
  if room is null then
    select id into room from chat.rooms where rdv_id = p_rdv;
    return room;
  end if;
  perform private.chat_add_member(room, uid);
  perform private.chat_add_member(room, s.user_id)
  from rdvs.rsvps s
  where s.rdv_id = p_rdv and s.answer in ('going', 'maybe') and private.is_active(s.user_id) and private.in_rdv_crews(p_rdv, s.user_id);
  return room;
end $$;
