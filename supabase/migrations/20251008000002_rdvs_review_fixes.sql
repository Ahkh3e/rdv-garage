-- RDV review fixes. An edit by a host who has left a crew keeps that crew's RDV rows, a reader of the RDV crew links
-- sees only their own crews, and account deletion does the RDV steps and removes the person's pins in one definition.

drop policy rdv_crews_read on rdvs.crews;
create policy rdv_crews_read on rdvs.crews for select to authenticated
  using (private.can_see_rdv(rdv_id, auth.uid()) and private.is_crew_member(crew_id, auth.uid()));

-- Host only, while the RDV has not ended and is not cancelled. Arrivals already recorded are left as they are.
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


create or replace function accounts.delete_account_data(p_user uuid) returns text
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

  -- 6. Memberships and selections.
  delete from crews.selections where user_id = p_user;
  delete from crews.members where user_id = p_user;

  -- 7. Tombstone the profile so the referral chain holds.
  update accounts.profiles
  set status = 'deleted',
      handle = 'deleted_' || substr(replace(id::text, '-', ''), 1, 10),
      avatar_path = null
  where id = p_user;

  return avatar;
end $$;
