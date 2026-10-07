-- RDVs: a place and a time for crews, RSVPs, and verified arrivals (docs/features/rdvs.md in the spec repo).
-- The place lives in its own table so a policy can hide a private event's place from members who have not answered
-- going or maybe. No member position is ever stored: arrivals hold only who, which RDV, when and how.

create schema if not exists rdvs;

create table rdvs.rdvs (
  id uuid primary key default gen_random_uuid(),
  host_id uuid references accounts.profiles (id) on delete set null,
  title text not null check (char_length(title) between 3 and 60),
  kind text not null check (kind in ('meet', 'cruise', 'private_event')),
  area_name text not null check (char_length(area_name) between 1 and 60),
  starts_at timestamptz not null,
  ends_at timestamptz check (ends_at is null or ends_at > starts_at),
  radius_m integer not null default 150 check (radius_m between 50 and 500),
  note text check (note is null or char_length(note) <= 280),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rdvs_host_idx on rdvs.rdvs (host_id);
create index rdvs_starts_idx on rdvs.rdvs (starts_at);

create table rdvs.places (
  rdv_id uuid primary key references rdvs.rdvs (id) on delete cascade,
  place_name text not null check (char_length(place_name) between 1 and 80),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180)
);

create table rdvs.crews (
  rdv_id uuid not null references rdvs.rdvs (id) on delete cascade,
  crew_id uuid not null references crews.crews (id) on delete cascade,
  primary key (rdv_id, crew_id)
);
create index rdv_crews_crew_idx on rdvs.crews (crew_id);

create table rdvs.rsvps (
  rdv_id uuid not null references rdvs.rdvs (id) on delete cascade,
  user_id uuid not null references accounts.profiles (id) on delete cascade,
  answer text not null check (answer in ('going', 'maybe', 'cant')),
  updated_at timestamptz not null default now(),
  primary key (rdv_id, user_id)
);
create index rsvps_user_idx on rdvs.rsvps (user_id);

create table rdvs.arrivals (
  rdv_id uuid not null references rdvs.rdvs (id) on delete cascade,
  user_id uuid not null references accounts.profiles (id) on delete cascade,
  arrived_at timestamptz not null default now(),
  method text not null check (method in ('live', 'here')),
  primary key (rdv_id, user_id)
);
create index arrivals_user_idx on rdvs.arrivals (user_id);

-- The end the RDV is held to: its end time, or three hours after the start.
create function private.rdv_end(p_starts timestamptz, p_ends timestamptz) returns timestamptz
language sql immutable set search_path = ''
as $$ select coalesce(p_ends, p_starts + interval '3 hours') $$;

-- Policy helpers are definer functions so the tables do not evaluate each other's policies.
create function private.can_see_rdv(p_rdv uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_active(p_user)
    and exists (
      select 1 from rdvs.crews rc
      where rc.rdv_id = p_rdv and private.is_crew_member(rc.crew_id, p_user)
    )
$$;

-- A private event's place is for the host and members who answered going or maybe.
create function private.can_see_rdv_place(p_rdv uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_see_rdv(p_rdv, p_user)
    and exists (
      select 1 from rdvs.rdvs r
      where r.id = p_rdv
        and (
          r.kind <> 'private_event'
          or r.host_id = p_user
          or exists (select 1 from rdvs.rsvps s where s.rdv_id = r.id and s.user_id = p_user and s.answer in ('going', 'maybe'))
        )
    )
$$;

-- Whether p_user is still in a crew the RDV is for. An answer from someone who left no longer counts.
create function private.in_rdv_crews(p_rdv uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from rdvs.crews rc
    where rc.rdv_id = p_rdv and private.is_crew_member(rc.crew_id, p_user)
  )
$$;

revoke execute on function private.can_see_rdv(uuid, uuid), private.can_see_rdv_place(uuid, uuid), private.in_rdv_crews(uuid, uuid) from public;
grant execute on function private.can_see_rdv(uuid, uuid), private.can_see_rdv_place(uuid, uuid), private.in_rdv_crews(uuid, uuid) to authenticated, service_role;

alter table rdvs.rdvs enable row level security;
alter table rdvs.places enable row level security;
alter table rdvs.crews enable row level security;
alter table rdvs.rsvps enable row level security;
alter table rdvs.arrivals enable row level security;

create policy rdvs_read on rdvs.rdvs for select to authenticated
  using (private.can_see_rdv(id, auth.uid()));

create policy rdv_places_read on rdvs.places for select to authenticated
  using (private.can_see_rdv_place(rdv_id, auth.uid()));

create policy rdv_crews_read on rdvs.crews for select to authenticated
  using (private.can_see_rdv(rdv_id, auth.uid()));

create policy rsvps_read on rdvs.rsvps for select to authenticated
  using (
    private.is_active(auth.uid())
    and (user_id = auth.uid() or (private.can_see_rdv(rdv_id, auth.uid()) and private.in_rdv_crews(rdv_id, user_id)))
  );

create policy arrivals_read on rdvs.arrivals for select to authenticated
  using (
    private.is_active(auth.uid())
    and (user_id = auth.uid() or private.can_see_rdv(rdv_id, auth.uid()))
  );

-- Normalises and checks the fields shared by create_rdv and update_rdv. Raises a stable code.
create function private.check_rdv_fields(
  p_title text, p_kind text, p_place_name text, p_lat double precision, p_lng double precision,
  p_note text, p_radius integer, p_starts timestamptz, p_ends timestamptz
) returns void
language plpgsql set search_path = ''
as $$
begin
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 60 then perform private.fail('rdv_title_invalid'); end if;
  if p_kind is null or p_kind not in ('meet', 'cruise', 'private_event') then perform private.fail('rdv_kind_invalid'); end if;
  if char_length(trim(coalesce(p_place_name, ''))) not between 1 and 80
     or p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    perform private.fail('rdv_place_invalid');
  end if;
  if p_note is not null and char_length(trim(p_note)) > 280 then perform private.fail('rdv_note_invalid'); end if;
  if p_radius is null or p_radius not between 50 and 500 then perform private.fail('rdv_radius_invalid'); end if;
  if p_starts is null then perform private.fail('rdv_time_invalid'); end if;
  if p_ends is not null and p_ends <= p_starts then perform private.fail('rdv_end_invalid'); end if;
end $$;

create function private.rdv_area(p_area text, p_place_name text) returns text
language sql immutable set search_path = ''
as $$ select left(coalesce(nullif(trim(coalesce(p_area, '')), ''), trim(p_place_name)), 60) $$;

create function rdvs.create_rdv(
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

-- Host only, while the RDV has not ended and is not cancelled. Arrivals already recorded are left as they are.
create function rdvs.update_rdv(
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
  delete from rdvs.crews where rdv_id = p_rdv and crew_id <> all (crew_ids);
  insert into rdvs.crews (rdv_id, crew_id) select p_rdv, c from (select distinct unnest(crew_ids) as c) s
  on conflict do nothing;
end $$;

-- The host, or an owner of a crew the RDV is for. Anyone else who can see it gets not_owner; anyone who cannot, rdv_not_found.
create function rdvs.cancel_rdv(p_rdv uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r rdvs.rdvs%rowtype;
begin
  select * into r from rdvs.rdvs where id = p_rdv;
  if r.id is null or not private.can_see_rdv(p_rdv, uid) then perform private.fail('rdv_not_found'); end if;
  if r.host_id is distinct from uid and not exists (
    select 1
    from rdvs.crews rc
    join crews.members m on m.crew_id = rc.crew_id and m.user_id = uid and m.role = 'owner'
    join crews.crews c on c.id = rc.crew_id and c.status = 'active'
    where rc.rdv_id = p_rdv
  ) then
    perform private.fail('not_owner');
  end if;
  if private.rdv_end(r.starts_at, r.ends_at) <= now() then perform private.fail('rdv_closed'); end if;
  update rdvs.rdvs set status = 'cancelled', updated_at = now() where id = p_rdv and status = 'scheduled';
end $$;

-- Upcoming and recent RDVs for the given crews, limited to crews the caller belongs to. A private event's place is
-- null until the caller is the host or answered going or maybe. A cancelled RDV is listed only until its window ends.
create function rdvs.list_rdvs(p_crew_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  return coalesce((
    select jsonb_agg(s.j order by s.starts_at, s.id)
    from (
      select r.id, r.starts_at,
        jsonb_build_object(
          'id', r.id,
          'host_id', r.host_id,
          'host_handle', h.handle,
          'title', r.title,
          'kind', r.kind,
          'area_name', r.area_name,
          'starts_at', r.starts_at,
          'ends_at', r.ends_at,
          'end_at', private.rdv_end(r.starts_at, r.ends_at),
          'radius_m', r.radius_m,
          'note', r.note,
          'status', r.status,
          'crew_ids', (
            select jsonb_agg(rc.crew_id order by rc.crew_id)
            from rdvs.crews rc
            where rc.rdv_id = r.id and private.is_crew_member(rc.crew_id, uid)
          ),
          'place', case when private.can_see_rdv_place(r.id, uid)
            then jsonb_build_object('name', pl.place_name, 'lat', pl.lat, 'lng', pl.lng) end,
          'going', (select count(*) from rdvs.rsvps x where x.rdv_id = r.id and x.answer = 'going' and private.in_rdv_crews(r.id, x.user_id)),
          'maybe', (select count(*) from rdvs.rsvps x where x.rdv_id = r.id and x.answer = 'maybe' and private.in_rdv_crews(r.id, x.user_id)),
          'cant', (select count(*) from rdvs.rsvps x where x.rdv_id = r.id and x.answer = 'cant' and private.in_rdv_crews(r.id, x.user_id)),
          'my_answer', (select x.answer from rdvs.rsvps x where x.rdv_id = r.id and x.user_id = uid),
          'arrived', exists (select 1 from rdvs.arrivals a where a.rdv_id = r.id and a.user_id = uid)
        ) as j
      from rdvs.rdvs r
      join rdvs.places pl on pl.rdv_id = r.id
      left join accounts.profiles h on h.id = r.host_id and h.status = 'active'
      where private.rdv_end(r.starts_at, r.ends_at) > now() - interval '14 days'
        and (r.status = 'scheduled' or private.rdv_end(r.starts_at, r.ends_at) > now())
        and exists (
          select 1 from rdvs.crews rc
          where rc.rdv_id = r.id
            and rc.crew_id = any (coalesce(p_crew_ids, '{}'::uuid[]))
            and private.is_crew_member(rc.crew_id, uid)
        )
    ) s
  ), '[]'::jsonb);
end $$;

-- Who answered what, for members of the RDV's crews. Answers from people who have left its crews are left out.
create function rdvs.list_rsvps(p_rdv uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  if not private.can_see_rdv(p_rdv, uid) then perform private.fail('rdv_not_found'); end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'user_id', s.user_id,
        'handle', p.handle,
        'avatar_path', p.avatar_path,
        'answer', s.answer,
        'arrived', exists (select 1 from rdvs.arrivals a where a.rdv_id = s.rdv_id and a.user_id = s.user_id)
      ) order by s.updated_at, s.user_id)
    from rdvs.rsvps s
    join accounts.profiles p on p.id = s.user_id and p.status = 'active'
    where s.rdv_id = p_rdv and private.in_rdv_crews(p_rdv, s.user_id)
  ), '[]'::jsonb);
end $$;

-- Allowed until the RDV ends, and not on a cancelled RDV.
create function rdvs.set_rsvp(p_rdv uuid, p_answer text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  r rdvs.rdvs%rowtype;
begin
  select * into r from rdvs.rdvs where id = p_rdv;
  if r.id is null or not private.can_see_rdv(p_rdv, uid) then perform private.fail('rdv_not_found'); end if;
  if p_answer is null or p_answer not in ('going', 'maybe', 'cant') then perform private.fail('rdv_answer_invalid'); end if;
  if r.status <> 'scheduled' or private.rdv_end(r.starts_at, r.ends_at) <= now() then perform private.fail('rdv_closed'); end if;
  insert into rdvs.rsvps (rdv_id, user_id, answer) values (p_rdv, uid, p_answer)
  on conflict (rdv_id, user_id) do update set answer = excluded.answer, updated_at = now();
end $$;

-- Service role only, for the record_arrival Edge Function. The function reads the place and radius to check a reading
-- against; the reading itself never reaches the database.
create function rdvs.arrival_target(p_user uuid, p_rdv uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_see_rdv_place(p_rdv, p_user) then return null; end if;
  return (
    select jsonb_build_object(
      'lat', pl.lat, 'lng', pl.lng, 'radius_m', r.radius_m, 'status', r.status,
      'starts_at', r.starts_at, 'end_at', private.rdv_end(r.starts_at, r.ends_at),
      'arrived', exists (select 1 from rdvs.arrivals a where a.rdv_id = r.id and a.user_id = p_user)
    )
    from rdvs.rdvs r join rdvs.places pl on pl.rdv_id = r.id
    where r.id = p_rdv
  );
end $$;

-- Service role only. Records the arrival once per member per RDV, inside the attendance window of an RDV that is
-- not cancelled. Returns false when the member had already arrived.
create function rdvs.store_arrival(p_user uuid, p_rdv uuid, p_method text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  r rdvs.rdvs%rowtype;
  inserted integer;
begin
  select * into r from rdvs.rdvs where id = p_rdv;
  if r.id is null or not private.can_see_rdv_place(p_rdv, p_user) then perform private.fail('rdv_not_found'); end if;
  if p_method is null or p_method not in ('live', 'here') then perform private.fail('rdv_method_invalid'); end if;
  if r.status <> 'scheduled' then perform private.fail('rdv_closed'); end if;
  if now() < r.starts_at - interval '1 hour' or now() > private.rdv_end(r.starts_at, r.ends_at) then
    perform private.fail('outside_window');
  end if;
  insert into rdvs.arrivals (rdv_id, user_id, method) values (p_rdv, p_user, p_method) on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;

-- Account deletion: hosted RDVs not yet ended are cancelled and keep their rows with the host cleared, the person's
-- answers and arrivals are removed, and other members' arrivals stay.
create or replace function accounts.delete_account_data(p_user uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  crew record;
  heir uuid;
  avatar text;
begin
  select avatar_path into avatar from accounts.profiles where id = p_user;

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

  update referral.invites
  set status = 'revoked', revoked_by = coalesce(revoked_by, 'inviter'), revoked_at = now()
  where inviter_id = p_user and status = 'active';

  update rdvs.rdvs
  set status = 'cancelled', updated_at = now()
  where host_id = p_user and status = 'scheduled' and private.rdv_end(starts_at, ends_at) > now();
  update rdvs.rdvs set host_id = null where host_id = p_user;
  delete from rdvs.rsvps where user_id = p_user;
  delete from rdvs.arrivals where user_id = p_user;

  delete from live.sessions where user_id = p_user;

  delete from crews.selections where user_id = p_user;
  delete from crews.members where user_id = p_user;

  update accounts.profiles
  set status = 'deleted',
      handle = 'deleted_' || substr(replace(id::text, '-', ''), 1, 10),
      avatar_path = null
  where id = p_user;

  return avatar;
end $$;

revoke all on all tables in schema rdvs from public, anon, authenticated;
grant usage on schema rdvs to anon, authenticated, service_role;
grant select on rdvs.rdvs, rdvs.places, rdvs.crews, rdvs.rsvps, rdvs.arrivals to authenticated;
grant all on all tables in schema rdvs to service_role;

revoke execute on all functions in schema rdvs from public;
grant execute on function
  rdvs.create_rdv(text, text, text, double precision, double precision, text, timestamptz, timestamptz, text, uuid[], integer),
  rdvs.update_rdv(uuid, text, text, text, double precision, double precision, text, timestamptz, timestamptz, text, uuid[], integer),
  rdvs.cancel_rdv(uuid), rdvs.list_rdvs(uuid[]), rdvs.list_rsvps(uuid), rdvs.set_rsvp(uuid, text)
  to authenticated;
grant execute on all functions in schema rdvs to service_role;
