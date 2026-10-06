-- Access policies, grants, storage, realtime authorization, scheduled jobs.
-- Privacy is enforced here, not in the app (decision 0004).

-- Row level security everywhere. Writes happen only through functions, so there are no write policies.
alter table accounts.profiles enable row level security;
alter table referral.invites enable row level security;
alter table crews.crews enable row level security;
alter table crews.members enable row level security;
alter table crews.selections enable row level security;
alter table live.sessions enable row level security;
alter table live.session_crews enable row level security;
alter table live.segments enable row level security;
alter table private.rate_limits enable row level security;
alter table private.settings enable row level security;

-- Profiles: yourself, or someone you share an active crew with. Both must be active.
create policy profiles_read on accounts.profiles for select to authenticated
  using (
    private.is_active(auth.uid())
    and (id = auth.uid() or (status = 'active' and private.shares_crew(auth.uid(), id)))
  );

create policy invites_read on referral.invites for select to authenticated
  using (inviter_id = auth.uid() and private.is_active(auth.uid()));

create policy crews_read on crews.crews for select to authenticated
  using (status = 'active' and private.is_crew_member(id, auth.uid()));

create policy members_read on crews.members for select to authenticated
  using (private.is_crew_member(crew_id, auth.uid()));

create policy selections_read on crews.selections for select to authenticated
  using (user_id = auth.uid() and private.is_active(auth.uid()));

create policy sessions_read on live.sessions for select to authenticated
  using (user_id = auth.uid() and private.is_active(auth.uid()));

create policy session_crews_read on live.session_crews for select to authenticated
  using (
    private.is_active(auth.uid())
    and (private.is_crew_member(crew_id, auth.uid())
         or exists (select 1 from live.sessions s where s.id = session_id and s.user_id = auth.uid()))
  );

-- A segment is readable only by members of the crews its session was shared with.
create policy segments_read on live.segments for select to authenticated
  using (
    private.is_active(auth.uid())
    and exists (
      select 1 from live.session_crews sc
      where sc.session_id = live.segments.session_id
        and private.is_crew_member(sc.crew_id, auth.uid())
    )
  );

-- Table privileges: read-only through policies, and only the columns that are safe to show.
revoke all on all tables in schema accounts, referral, crews, live, leaderboard from public, anon, authenticated;
grant usage on schema accounts, referral, crews, live, leaderboard to anon, authenticated, service_role;

grant select (id, handle, avatar_path, status, created_at) on accounts.profiles to authenticated;
grant select (id, inviter_id, created_at, expires_at, status) on referral.invites to authenticated;
grant select (id, name, description, avatar_path, owner_id, status, created_at) on crews.crews to authenticated;
grant select on crews.members, crews.selections to authenticated;
grant select on live.sessions, live.session_crews, live.segments to authenticated;

grant all on all tables in schema accounts, referral, crews, live to service_role;
grant all on all tables in schema private to service_role;

-- Functions: nothing is callable by default. Grant each one deliberately.
revoke execute on all functions in schema accounts, referral, crews, live, leaderboard from public;

-- Signed-in users
grant execute on function
  accounts.my_profile(), accounts.update_profile(text, text, boolean),
  accounts.list_sessions(), accounts.revoke_session(uuid), accounts.revoke_other_sessions(),
  referral.create_invite(), referral.revoke_invite(uuid), referral.list_my_invites(),
  crews.create_crew(text, text, text), crews.join_crew(text), crews.leave_crew(uuid),
  crews.remove_member(uuid, uuid), crews.transfer_ownership(uuid, uuid),
  crews.regenerate_crew_link(uuid), crews.delete_crew(uuid), crews.list_my_crews(),
  crews.set_selected_crews(uuid[]),
  live.start_session(uuid[], text), live.checkpoint_session(uuid, real, real, date), live.end_session(uuid),
  leaderboard.weekly_top_speed(uuid, date)
  to authenticated;

-- Anonymous (rate limited inside the function)
grant execute on function referral.check_invite(text) to anon, authenticated;
grant execute on function public.ping() to anon, authenticated;

-- Service role only: register, deletion, suspension, sweeps, operator tooling
grant execute on all functions in schema accounts, referral, crews, live, leaderboard to service_role;

-- Storage: private avatar bucket, one folder per user.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy avatars_owner_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and private.is_active(auth.uid()));
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
-- Visible only to the owner and people who share a crew with them.
create policy avatars_read on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and private.is_active(auth.uid())
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or private.shares_crew(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  );

-- Realtime: private per-crew channels, topic crew:<crew id>.
create policy crew_channel_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.can_receive_topic((select realtime.topic()))
  );
create policy crew_channel_send on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.can_send_topic((select realtime.topic()))
  );

-- Scheduled jobs run inside the database and need no external secrets.
create extension if not exists pg_cron;
select cron.schedule('rdv-sweep-stale-sessions', '* * * * *', $$select live.sweep_stale()$$);
select cron.schedule('rdv-cleanup-unconfirmed', '17 * * * *', $$select accounts.cleanup_unconfirmed()$$);
