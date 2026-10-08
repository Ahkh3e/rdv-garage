-- Review fixes for the walkie-talkie migration: nobody changes their own voice access, restoring voice queues nothing,
-- and queued kicks outlive the token (re-sent while the person is still not allowed), and the token roster.

-- Queue: a row lives for the token lifetime plus a margin and is re-sent every minute while the person is still out.
create or replace function private.walkie_send(p_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  k private.walkie_kicks%rowtype;
  r chat.rooms%rowtype;
  target text := private.setting('walkie_kick_url');
  secret text := private.setting('walkie_kick_secret');
  still_out boolean;
  req bigint;
begin
  select * into k from private.walkie_kicks where id = p_id;
  if k.id is null then return; end if;
  if k.created_at < now() - interval '6 minutes' then
    delete from private.walkie_kicks where id = p_id;
    return;
  end if;
  select * into r from chat.rooms where id = k.room_id;
  if k.user_id is null then
    still_out := r.id is null or r.status = 'closed';
  else
    still_out := r.id is null or r.status = 'closed'
      or not private.chat_is_member(k.room_id, k.user_id)
      or not private.voice_allowed(k.room_id, k.user_id);
  end if;
  if not still_out then
    delete from private.walkie_kicks where id = p_id;
    return;
  end if;
  if coalesce(target, '') = '' or coalesce(secret, '') = '' then return; end if;
  select net.http_post(
    url := target,
    body := jsonb_build_object('room_id', k.room_id, 'user_id', k.user_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-walkie-secret', secret),
    timeout_milliseconds := 5000
  ) into req;
  update private.walkie_kicks set attempts = attempts + 1, request_id = req, sent_at = now() where id = p_id;
end $$;

-- A success answer does not end a kick: the person may rejoin with a token minted before the change.
create or replace function private.walkie_retry() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  k private.walkie_kicks%rowtype;
  n integer := 0;
begin
  delete from private.walkie_kicks where created_at < now() - interval '6 minutes';
  for k in
    select * from private.walkie_kicks
    where sent_at is null or sent_at < now() - interval '45 seconds'
  loop
    perform private.walkie_send(k.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- set_voice_access ------------------------------------------------------------------------------

create or replace function crews.set_voice_access(p_crew uuid, p_user uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  caller text;
  target text;
  rid uuid;
begin
  select m.role into caller from crews.members m join crews.crews c on c.id = m.crew_id and c.status = 'active'
  where m.crew_id = p_crew and m.user_id = uid;
  if caller is null or caller = 'member' then perform private.fail('not_moderator'); end if;
  if p_user = uid then perform private.fail('cannot_moderate_admin'); end if;
  select m.role into target from crews.members m join accounts.profiles p on p.id = m.user_id and p.status = 'active'
  where m.crew_id = p_crew and m.user_id = p_user;
  if target is null then perform private.fail('not_a_member'); end if;
  if caller = 'admin' and target <> 'member' then perform private.fail('cannot_moderate_admin'); end if;
  if p_allowed then
    update crews.members set voice_revoked_at = null, voice_revoked_by = null where crew_id = p_crew and user_id = p_user;
    return;
  end if;
  update crews.members set voice_revoked_at = now(), voice_revoked_by = uid where crew_id = p_crew and user_id = p_user;
  for rid in
    select m.room_id from chat.members m join chat.rooms r on r.id = m.room_id
    where m.user_id = p_user and not m.blocked and r.status = 'active'
      and (r.crew_id = p_crew or r.rdv_id in (select rc.rdv_id from rdvs.crews rc where rc.crew_id = p_crew))
  loop
    perform private.walkie_kick(rid, p_user);
  end loop;
end $$;

-- Token minting: the members whose participant ids the client may map ------------------------------------

create or replace function chat.walkie_access(p_room uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  r chat.rooms%rowtype;
  names text[];
  members uuid[];
begin
  select * into r from chat.rooms where id = p_room;
  if r.id is null then return jsonb_build_object('state', 'room_not_found'); end if;
  if not private.is_active(p_user) then return jsonb_build_object('state', 'suspended'); end if;
  if not private.chat_is_member(p_room, p_user) then return jsonb_build_object('state', 'not_room_member'); end if;
  if r.status = 'closed' then return jsonb_build_object('state', 'room_closed'); end if;
  select coalesce(array_agg(c.name order by c.name), '{}') into names
  from private.voice_revoked_crews(p_room, p_user) v join crews.crews c on c.id = v;
  select coalesce(array_agg(m.user_id order by m.user_id), '{}') into members
  from chat.members m join accounts.profiles p on p.id = m.user_id and p.status = 'active'
  where m.room_id = p_room and not m.blocked;
  return jsonb_build_object('state', 'ok', 'can_publish', coalesce(array_length(names, 1), 0) = 0,
    'voice_off_crews', to_jsonb(names), 'member_ids', to_jsonb(members));
end $$;

-- The walkie:<room_id> channel is gone: who is talking comes from the audio service, not from member broadcasts.
drop policy walkie_channel_receive on realtime.messages;
drop policy walkie_channel_send on realtime.messages;
drop function private.can_use_walkie_topic(text);
drop function private.walkie_topic_room(text);
