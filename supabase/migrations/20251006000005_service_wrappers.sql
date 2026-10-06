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

-- Single source for the terms version: the register function reads it here instead of hardcoding it.
create function accounts.current_terms_version() returns text
language sql stable security definer set search_path = ''
as $$ select private.setting('terms_version') $$;

-- Old counters have no value after their window; keep the table small.
create function private.purge_rate_limits() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from private.rate_limits where window_start < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end $$;
select cron.schedule('rdv-purge-rate-limits', '29 * * * *', $cron$select private.purge_rate_limits()$cron$);

revoke execute on function accounts.rate_limit(text, integer, integer), accounts.revoke_sessions_except(uuid, uuid) from public;
grant execute on function accounts.rate_limit(text, integer, integer), accounts.revoke_sessions_except(uuid, uuid), accounts.current_terms_version() to service_role;
revoke execute on function private.purge_rate_limits() from public;
grant execute on function private.purge_rate_limits() to service_role;
