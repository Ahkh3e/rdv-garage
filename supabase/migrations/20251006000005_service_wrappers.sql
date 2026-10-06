-- Service-role wrappers used by Edge Functions. Not callable by app users.

create function accounts.rate_limit(p_key text, p_max integer, p_window_seconds integer) returns void
language plpgsql security definer set search_path = ''
as $$ begin perform private.hit_rate_limit(p_key, p_max, p_window_seconds); end $$;

create function accounts.revoke_sessions_except(p_user uuid, p_keep uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from auth.sessions where user_id = p_user and id is distinct from p_keep;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function accounts.rate_limit(text, integer, integer), accounts.revoke_sessions_except(uuid, uuid) from public;
grant execute on function accounts.rate_limit(text, integer, integer), accounts.revoke_sessions_except(uuid, uuid) to service_role;
