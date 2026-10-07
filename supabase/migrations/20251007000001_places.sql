-- Places: pins dropped on the map for chosen crews (docs/features/places.md in the spec repo).
-- A pin is a place, never a person. Readable only by members of a listed crew while it has not expired.

create schema if not exists places;

create table places.pins (
  id uuid primary key default gen_random_uuid(),
  dropper_id uuid not null references accounts.profiles (id) on delete cascade,
  label text not null check (char_length(label) between 3 and 40),
  note text check (note is null or char_length(note) <= 140),
  address text check (address is null or char_length(address) <= 200),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now()
);
create index pins_dropper_idx on places.pins (dropper_id);
create index pins_expires_idx on places.pins (expires_at);

create table places.pin_crews (
  pin_id uuid not null references places.pins (id) on delete cascade,
  crew_id uuid not null references crews.crews (id) on delete cascade,
  primary key (pin_id, crew_id)
);
create index pin_crews_crew_idx on places.pin_crews (crew_id);

-- Policy helpers are definer functions so the two tables do not evaluate each other's policies.
create function private.can_see_pin(p_pin uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_active(p_user)
    and exists (
      select 1
      from places.pins p
      join places.pin_crews pc on pc.pin_id = p.id
      where p.id = p_pin
        and p.expires_at > now()
        and private.is_active(p.dropper_id)
        and private.is_crew_member(pc.crew_id, p_user)
    )
$$;

revoke execute on function private.can_see_pin(uuid, uuid) from public;
grant execute on function private.can_see_pin(uuid, uuid) to authenticated, service_role;

alter table places.pins enable row level security;
alter table places.pin_crews enable row level security;

create policy pins_read on places.pins for select to authenticated
  using (private.can_see_pin(id, auth.uid()));

create policy pin_crews_read on places.pin_crews for select to authenticated
  using (private.is_crew_member(crew_id, auth.uid()) and private.can_see_pin(pin_id, auth.uid()));

create function places.drop_pin(
  p_label text, p_note text, p_lat double precision, p_lng double precision, p_address text, p_crew_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  label_clean text := trim(coalesce(p_label, ''));
  note_clean text := nullif(trim(coalesce(p_note, '')), '');
  address_clean text := nullif(trim(coalesce(p_address, '')), '');
  crew_ids uuid[] := coalesce(p_crew_ids, '{}'::uuid[]);
  crew uuid;
  pin_id uuid;
begin
  if char_length(label_clean) not between 3 and 40 then perform private.fail('pin_label_invalid'); end if;
  if note_clean is not null and char_length(note_clean) > 140 then perform private.fail('pin_note_invalid'); end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    perform private.fail('pin_place_invalid');
  end if;
  if address_clean is not null and char_length(address_clean) > 200 then address_clean := left(address_clean, 200); end if;
  if cardinality(crew_ids) = 0 then perform private.fail('pin_crew_required'); end if;
  foreach crew in array crew_ids loop
    if not private.is_crew_member(crew, uid) then perform private.fail('not_a_member'); end if;
  end loop;
  insert into places.pins (dropper_id, label, note, address, lat, lng)
  values (uid, label_clean, note_clean, address_clean, p_lat, p_lng)
  returning id into pin_id;
  insert into places.pin_crews (pin_id, crew_id)
  select pin_id, c from (select distinct unnest(crew_ids) as c) s;
  return pin_id;
end $$;

-- The dropper, or an owner of any crew the pin was dropped for. Anyone else who cannot see it gets pin_not_found.
create function places.remove_pin(p_pin uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  dropper uuid;
begin
  select p.dropper_id into dropper from places.pins p where p.id = p_pin and p.expires_at > now();
  if dropper is null then perform private.fail('pin_not_found'); end if;
  if dropper <> uid and not exists (
    select 1
    from places.pin_crews pc
    join crews.members m on m.crew_id = pc.crew_id and m.user_id = uid and m.role = 'owner'
    join crews.crews c on c.id = pc.crew_id and c.status = 'active'
    where pc.pin_id = p_pin
  ) then
    if private.can_see_pin(p_pin, uid) then perform private.fail('not_owner'); end if;
    perform private.fail('pin_not_found');
  end if;
  delete from places.pins where id = p_pin;
end $$;

-- Unexpired pins for the given crews, limited to crews the caller belongs to.
create function places.list_pins(p_crew_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'dropper_id', p.dropper_id,
        'dropper_handle', d.handle,
        'label', p.label,
        'note', p.note,
        'address', p.address,
        'lat', p.lat,
        'lng', p.lng,
        'expires_at', p.expires_at,
        'created_at', p.created_at,
        'crew_ids', (
          select jsonb_agg(pc.crew_id order by pc.crew_id)
          from places.pin_crews pc
          where pc.pin_id = p.id
            and pc.crew_id = any (coalesce(p_crew_ids, '{}'::uuid[]))
            and private.is_crew_member(pc.crew_id, uid)
        )
      ) order by p.created_at desc)
    from places.pins p
    join accounts.profiles d on d.id = p.dropper_id and d.status = 'active'
    where p.expires_at > now()
      and exists (
        select 1 from places.pin_crews pc
        where pc.pin_id = p.id
          and pc.crew_id = any (coalesce(p_crew_ids, '{}'::uuid[]))
          and private.is_crew_member(pc.crew_id, uid)
      )
  ), '[]'::jsonb);
end $$;

create function places.sweep_expired() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from places.pins where expires_at < now() - interval '1 hour';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on all tables in schema places from public, anon, authenticated;
grant usage on schema places to anon, authenticated, service_role;
grant select (id, dropper_id, label, note, address, lat, lng, expires_at, created_at) on places.pins to authenticated;
grant select on places.pin_crews to authenticated;
grant all on all tables in schema places to service_role;

revoke execute on all functions in schema places from public;
grant execute on function places.drop_pin(text, text, double precision, double precision, text, uuid[]),
  places.remove_pin(uuid), places.list_pins(uuid[]) to authenticated;
grant execute on all functions in schema places to service_role;

select cron.schedule('rdv-sweep-expired-pins', '*/15 * * * *', $$select places.sweep_expired()$$);
