alter table crews.members drop constraint members_voice_revoked_by_fkey;
alter table crews.members add constraint members_voice_revoked_by_fkey foreign key (voice_revoked_by) references accounts.profiles (id) on delete set null;

create or replace function crews.remove_member(p_crew uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := private.require_active();
  caller text;
  target text;
begin
  if p_user = uid then
    perform crews.leave_crew(p_crew);
    return;
  end if;
  select role into caller from crews.members where crew_id = p_crew and user_id = uid;
  if caller is null or caller = 'member' then perform private.fail('not_moderator'); end if;
  select role into target from crews.members where crew_id = p_crew and user_id = p_user;
  if target is null then perform private.fail('not_a_member'); end if;
  if caller = 'admin' and target <> 'member' then perform private.fail('cannot_moderate_admin'); end if;
  perform crews.drop_membership(p_crew, p_user);
end $$;

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
              'role', m.role,
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
