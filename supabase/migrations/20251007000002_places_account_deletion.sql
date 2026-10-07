-- Account deletion also removes the person's pins right away, so nothing they dropped outlives the account.
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

  -- 3. Live data.
  delete from live.sessions where user_id = p_user;

  -- 4. Pins dropped by the person.
  delete from places.pins where dropper_id = p_user;

  -- 5. Memberships and selections.
  delete from crews.selections where user_id = p_user;
  delete from crews.members where user_id = p_user;

  -- 6. Tombstone the profile so the referral chain holds.
  update accounts.profiles
  set status = 'deleted',
      handle = 'deleted_' || substr(replace(id::text, '-', ''), 1, 10),
      avatar_path = null
  where id = p_user;

  return avatar;
end $$;
