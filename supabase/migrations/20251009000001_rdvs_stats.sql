-- Meets attended: the caller's own verified arrivals, including those at RDVs of crews they have since left.
create function rdvs.my_meets_attended() returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  return (select count(*)::integer from rdvs.arrivals where user_id = uid);
end $$;

revoke execute on function rdvs.my_meets_attended() from public;
grant execute on function rdvs.my_meets_attended() to authenticated, service_role;
