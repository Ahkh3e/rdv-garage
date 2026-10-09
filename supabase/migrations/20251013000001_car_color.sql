-- Car colour: a nullable choice from a fixed neon palette, shown to members of shared crews like the car icon.
alter table accounts.profiles
  add column car_color text check (car_color in ('blue','cyan','green','lime','yellow','orange','red','pink','purple','white'));

grant select (car_color) on accounts.profiles to authenticated;

drop function accounts.my_profile();
create function accounts.my_profile() returns table (
  id uuid, handle text, avatar_path text, car_icon text, car_color text, status text, terms_version text, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then perform private.fail('unauthenticated'); end if;
  return query
    select p.id, p.handle, p.avatar_path, p.car_icon, p.car_color, p.status, p.terms_version, p.created_at
    from accounts.profiles p where p.id = uid;
end $$;

drop function accounts.update_profile(text, text, boolean, text);
create function accounts.update_profile(
  p_handle text default null, p_avatar_path text default null, p_clear_avatar boolean default false, p_car_icon text default null,
  p_car_color text default null, p_clear_car_color boolean default false
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  cur accounts.profiles;
begin
  select * into cur from accounts.profiles where id = uid;
  if p_handle is not null and p_handle <> cur.handle then
    if not accounts.handle_valid(p_handle) then
      perform private.fail('handle_invalid');
    end if;
    if cur.handle_changed_at is not null
       and cur.handle_changed_at > now() - make_interval(days => private.setting('handle_cooldown_days')::integer) then
      perform private.fail('handle_cooldown');
    end if;
    begin
      update accounts.profiles set handle = p_handle, handle_changed_at = now() where id = uid;
    exception when unique_violation then
      perform private.fail('handle_taken');
    end;
  end if;
  if p_clear_avatar then
    update accounts.profiles set avatar_path = null where id = uid;
  elsif p_avatar_path is not null then
    if split_part(p_avatar_path, '/', 1) <> uid::text then
      perform private.fail('not_a_member');
    end if;
    update accounts.profiles set avatar_path = p_avatar_path where id = uid;
  end if;
  if p_car_icon is not null then
    if p_car_icon not in ('gt','formula','proto','rally','muscle','hyper','drift','kart') then
      perform private.fail('icon_invalid');
    end if;
    update accounts.profiles set car_icon = p_car_icon where id = uid;
  end if;
  if p_clear_car_color then
    update accounts.profiles set car_color = null where id = uid;
  elsif p_car_color is not null then
    if p_car_color not in ('blue','cyan','green','lime','yellow','orange','red','pink','purple','white') then
      perform private.fail('color_invalid');
    end if;
    update accounts.profiles set car_color = p_car_color where id = uid;
  end if;
end $$;

grant execute on function accounts.my_profile(), accounts.update_profile(text, text, boolean, text, text, boolean) to authenticated;

-- Same body as the previous definition (walkie migration), plus car_color in each member.
create or replace function crews.list_my_crews() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'avatar_path', c.avatar_path,
        'owner_id', c.owner_id,
        'role', me.role,
        'link_code', case when me.role = 'owner' then c.link_code else null end,
        'selected', exists (select 1 from crews.selections s where s.user_id = uid and s.crew_id = c.id),
        'members', (
          select jsonb_agg(
            jsonb_build_object(
              'user_id', p.id,
              'handle', p.handle,
              'avatar_path', p.avatar_path,
              'car_icon', p.car_icon,
              'car_color', p.car_color,
              'role', m.role,
              'voice_off', (me.role in ('owner', 'admin') or m.user_id = uid) and m.voice_revoked_at is not null,
              'live', exists (
                select 1 from live.sessions ls
                join live.session_crews sc on sc.session_id = ls.id and sc.crew_id = c.id
                where ls.user_id = p.id and ls.ended_at is null and ls.last_seen_at > private.stale_cutoff()
              )
            ) order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, p.handle)
          from crews.members m
          join accounts.profiles p on p.id = m.user_id and p.status = 'active'
          where m.crew_id = c.id
        )
      ) order by c.created_at)
    from crews.crews c
    join crews.members me on me.crew_id = c.id and me.user_id = uid
    where c.status = 'active'
  ), '[]'::jsonb);
end $$;
