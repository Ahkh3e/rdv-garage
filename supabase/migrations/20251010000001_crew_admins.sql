alter table crews.members drop constraint members_role_check;
alter table crews.members add constraint members_role_check check (role in ('owner', 'admin', 'member'));
alter table crews.members add column voice_revoked_at timestamptz;
alter table crews.members add column voice_revoked_by uuid references accounts.profiles (id);

create function private.is_crew_moderator(p_crew uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from crews.members where crew_id = p_crew and user_id = p_user and role in ('owner', 'admin'));
$$;

create function crews.promote_admin(p_crew uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  if not exists (select 1 from crews.members where crew_id = p_crew and user_id = uid and role = 'owner') then
    perform private.fail('not_owner');
  end if;
  update crews.members set role = 'admin' where crew_id = p_crew and user_id = p_user and role in ('admin', 'member');
  if not found then perform private.fail('not_a_member'); end if;
end $$;

create function crews.demote_admin(p_crew uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := private.require_active();
begin
  if not exists (select 1 from crews.members where crew_id = p_crew and user_id = uid and role = 'owner') then
    perform private.fail('not_owner');
  end if;
  update crews.members set role = 'member' where crew_id = p_crew and user_id = p_user and role in ('admin', 'member');
  if not found then perform private.fail('not_a_member'); end if;
end $$;

create or replace function crews.remove_member(p_crew uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  caller text;
  target text;
begin
  select role into caller from crews.members where crew_id = p_crew and user_id = uid;
  if caller is null or caller = 'member' then perform private.fail('not_moderator'); end if;
  if p_user = uid and caller = 'owner' then perform private.fail('owner_must_transfer'); end if;
  select role into target from crews.members where crew_id = p_crew and user_id = p_user;
  if target is null then perform private.fail('not_a_member'); end if;
  if caller = 'admin' and target <> 'member' and p_user <> uid then perform private.fail('cannot_moderate_admin'); end if;
  perform crews.drop_membership(p_crew, p_user);
end $$;

create or replace function places.remove_pin(p_pin uuid) returns void
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
    join crews.crews c on c.id = pc.crew_id and c.status = 'active'
    where pc.pin_id = p_pin and private.is_crew_moderator(pc.crew_id, uid)
  ) then
    if private.can_see_pin(p_pin, uid) then perform private.fail('not_moderator'); end if;
    perform private.fail('pin_not_found');
  end if;
  delete from places.pins where id = p_pin;
end $$;

create or replace function rdvs.cancel_rdv(p_rdv uuid) returns void
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
    join crews.crews c on c.id = rc.crew_id and c.status = 'active'
    where rc.rdv_id = p_rdv and private.is_crew_moderator(rc.crew_id, uid)
  ) then
    perform private.fail('not_moderator');
  end if;
  if private.rdv_end(r.starts_at, r.ends_at) <= now() then perform private.fail('rdv_closed'); end if;
  update rdvs.rdvs set status = 'cancelled', updated_at = now() where id = p_rdv and status = 'scheduled';
end $$;

revoke execute on function crews.promote_admin(uuid, uuid), crews.demote_admin(uuid, uuid), private.is_crew_moderator(uuid, uuid) from public;
grant execute on function crews.promote_admin(uuid, uuid), crews.demote_admin(uuid, uuid) to authenticated, service_role;
