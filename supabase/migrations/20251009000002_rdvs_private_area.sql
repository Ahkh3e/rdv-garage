-- A private event shows its area to members who have not answered, so the host must name it. It is never defaulted to the
-- place name or street. Other kinds keep the fallback.

create or replace function rdvs.create_rdv(
  p_title text, p_kind text, p_place_name text, p_lat double precision, p_lng double precision, p_area_name text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_note text, p_crew_ids uuid[], p_radius_m integer default 150
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  crew_ids uuid[] := coalesce(p_crew_ids, '{}'::uuid[]);
  crew uuid;
  new_id uuid;
begin
  perform private.check_rdv_fields(p_title, p_kind, p_place_name, p_lat, p_lng, p_note, p_radius_m, p_starts_at, p_ends_at);
  if p_kind = 'private_event' and (
    nullif(trim(coalesce(p_area_name, '')), '') is null
    or lower(trim(p_area_name)) = lower(trim(coalesce(p_place_name, '')))
  ) then perform private.fail('rdv_area_required'); end if;
  if p_starts_at < now() then perform private.fail('rdv_in_past'); end if;
  if cardinality(crew_ids) = 0 then perform private.fail('rdv_crew_required'); end if;
  foreach crew in array crew_ids loop
    if not private.is_crew_member(crew, uid) then perform private.fail('not_a_member'); end if;
  end loop;
  insert into rdvs.rdvs (host_id, title, kind, area_name, starts_at, ends_at, radius_m, note)
  values (uid, trim(p_title), p_kind, private.rdv_area(p_area_name, p_place_name), p_starts_at, p_ends_at, p_radius_m, nullif(trim(coalesce(p_note, '')), ''))
  returning id into new_id;
  insert into rdvs.places (rdv_id, place_name, lat, lng) values (new_id, trim(p_place_name), p_lat, p_lng);
  insert into rdvs.crews (rdv_id, crew_id) select new_id, c from (select distinct unnest(crew_ids) as c) s;
  return new_id;
end $$;

create or replace function rdvs.update_rdv(
  p_rdv uuid, p_title text, p_kind text, p_place_name text, p_lat double precision, p_lng double precision, p_area_name text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_note text, p_crew_ids uuid[], p_radius_m integer default 150
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r rdvs.rdvs%rowtype;
  crew_ids uuid[] := coalesce(p_crew_ids, '{}'::uuid[]);
  crew uuid;
begin
  select * into r from rdvs.rdvs where id = p_rdv;
  if r.id is null or not private.can_see_rdv(p_rdv, uid) then perform private.fail('rdv_not_found'); end if;
  if r.host_id is distinct from uid then perform private.fail('not_host'); end if;
  if r.status <> 'scheduled' or private.rdv_end(r.starts_at, r.ends_at) <= now() then perform private.fail('rdv_closed'); end if;
  perform private.check_rdv_fields(p_title, p_kind, p_place_name, p_lat, p_lng, p_note, p_radius_m, p_starts_at, p_ends_at);
  if p_kind = 'private_event' and (
    nullif(trim(coalesce(p_area_name, '')), '') is null
    or lower(trim(p_area_name)) = lower(trim(coalesce(p_place_name, '')))
  ) then perform private.fail('rdv_area_required'); end if;
  -- A start the app sends back unchanged may have lost sub-millisecond precision.
  if abs(extract(epoch from (p_starts_at - r.starts_at))) >= 1 and p_starts_at < now() then perform private.fail('rdv_in_past'); end if;
  if private.rdv_end(p_starts_at, p_ends_at) <= now() then perform private.fail('rdv_in_past'); end if;
  if cardinality(crew_ids) = 0 then perform private.fail('rdv_crew_required'); end if;
  foreach crew in array crew_ids loop
    if not private.is_crew_member(crew, uid) then perform private.fail('not_a_member'); end if;
  end loop;
  update rdvs.rdvs
  set title = trim(p_title), kind = p_kind, area_name = private.rdv_area(p_area_name, p_place_name),
      starts_at = p_starts_at, ends_at = p_ends_at, radius_m = p_radius_m,
      note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_rdv;
  update rdvs.places set place_name = trim(p_place_name), lat = p_lat, lng = p_lng where rdv_id = p_rdv;
  delete from rdvs.crews where rdv_id = p_rdv and crew_id <> all (crew_ids) and private.is_crew_member(crew_id, uid);
  insert into rdvs.crews (rdv_id, crew_id) select p_rdv, c from (select distinct unnest(crew_ids) as c) s
  on conflict do nothing;
end $$;
