-- Private helpers. Not exposed through the API (schema private has no grants to API roles).

create function private.setting(p_key text) returns text
language sql stable security definer set search_path = ''
as $$ select value from private.settings where key = p_key $$;

create function private.fail(p_code text) returns void
language plpgsql set search_path = ''
as $$ begin raise exception using errcode = 'P0001', message = p_code; end $$;

create function private.client_ip() returns text
language plpgsql stable set search_path = ''
as $$
declare
  headers json;
  ip text;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    headers := null;
  end;
  ip := split_part(coalesce(headers ->> 'x-forwarded-for', headers ->> 'x-real-ip', ''), ',', 1);
  return coalesce(nullif(trim(ip), ''), 'unknown');
end $$;

-- Fixed-window rate limit. Raises rate_limited when the window is full.
create function private.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  current_count integer;
begin
  insert into private.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
        count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end
  returning count into current_count;
  if current_count > p_max then
    perform private.fail('rate_limited');
  end if;
end $$;

-- Random code from a 32-character alphabet (no 0, 1, I, O). 256 is divisible by 32, so no modulo bias.
create function private.gen_code(p_length integer) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(p_length);
  result text := '';
  i integer;
begin
  for i in 0 .. p_length - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end $$;

-- The caller must be a signed-in active profile. Returns the user id.
create function private.require_active() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  st text;
begin
  if uid is null then
    perform private.fail('unauthenticated');
  end if;
  select status into st from accounts.profiles where id = uid;
  if st is null then
    perform private.fail('not_a_member');
  elsif st <> 'active' then
    perform private.fail('suspended');
  end if;
  return uid;
end $$;

create function private.is_active(p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from accounts.profiles where id = p_user and status = 'active') $$;

create function private.is_crew_member(p_crew uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from crews.members m
    join crews.crews c on c.id = m.crew_id and c.status = 'active'
    where m.crew_id = p_crew and m.user_id = p_user
  ) and private.is_active(p_user)
$$;

create function private.shares_crew(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from crews.members a
    join crews.members b on b.crew_id = a.crew_id
    join crews.crews c on c.id = a.crew_id and c.status = 'active'
    where a.user_id = p_a and b.user_id = p_b
  )
$$;

-- Monday of the Toronto-time week containing p_ts.
create function private.week_start_of(p_ts timestamptz) returns date
language sql stable set search_path = ''
as $$ select date_trunc('week', p_ts at time zone private.setting('toronto_tz'))::date $$;

create function private.current_week_start() returns date
language sql stable set search_path = ''
as $$ select private.week_start_of(now()) $$;

create function private.stale_cutoff() returns timestamptz
language sql stable set search_path = ''
as $$ select now() - make_interval(mins => private.setting('stale_session_minutes')::integer) $$;

create function private.crew_topic_id(p_topic text) returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  if p_topic like 'crew:%' then
    return substr(p_topic, 6)::uuid;
  end if;
  return null;
exception when others then
  return null;
end $$;

-- Realtime authorization --------------------------------------------------
-- Members can receive on their crew's private channel. Only a user with a live
-- session shared with that crew can send.
create function private.can_receive_topic(p_topic text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.is_crew_member(private.crew_topic_id(p_topic), auth.uid()), false)
$$;

create function private.can_send_topic(p_topic text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    private.is_crew_member(private.crew_topic_id(p_topic), auth.uid())
    and exists (
      select 1
      from live.sessions s
      join live.session_crews sc on sc.session_id = s.id
      where s.user_id = auth.uid()
        and s.ended_at is null
        and s.last_seen_at > private.stale_cutoff()
        and sc.crew_id = private.crew_topic_id(p_topic)
    ),
    false)
$$;

-- API roles evaluate access policies, so they need to resolve a few helpers.
-- Everything else in private stays callable only by the service role and by definer functions.
revoke execute on all functions in schema private from public;
grant usage on schema private to authenticated, anon;
grant execute on all functions in schema private to service_role;
grant execute on function private.is_active(uuid), private.is_crew_member(uuid, uuid),
  private.shares_crew(uuid, uuid), private.can_receive_topic(text), private.can_send_topic(text)
  to authenticated;
