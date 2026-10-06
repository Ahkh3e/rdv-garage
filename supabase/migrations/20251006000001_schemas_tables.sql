-- RDV Garage 0.0.1: schemas, settings, tables.
-- One schema per module (docs/architecture.md in the spec repo). Shared only: accounts.profiles and crews.members.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
create schema if not exists accounts;
create schema if not exists referral;
create schema if not exists crews;
create schema if not exists live;
create schema if not exists leaderboard;

revoke all on schema private from public;
grant usage on schema private to service_role;

-- Constants used everywhere, one place.
create table private.settings (
  key text primary key,
  value text not null
);
insert into private.settings (key, value) values
  ('terms_version', 'v1'),
  ('stale_session_minutes', '5'),
  ('invite_ttl_hours', '24'),
  ('invite_register_grace_minutes', '60'),
  ('handle_cooldown_days', '30'),
  ('toronto_tz', 'America/Toronto');

create table private.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- accounts ------------------------------------------------------------------
create table accounts.profiles (
  id uuid primary key,
  handle text not null,
  avatar_path text,
  invited_by uuid references accounts.profiles (id),
  invite_id uuid,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  terms_version text,
  terms_accepted_at timestamptz,
  handle_changed_at timestamptz,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,20}$')
);
create unique index profiles_handle_key on accounts.profiles (handle);
create index profiles_invited_by_idx on accounts.profiles (invited_by);
create index profiles_invite_id_idx on accounts.profiles (invite_id);

-- referral ------------------------------------------------------------------
create table referral.invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references accounts.profiles (id),
  code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'disabled')),
  revoked_by text check (revoked_by in ('inviter', 'operator', 'suspension')),
  revoked_at timestamptz
);
create index invites_inviter_idx on referral.invites (inviter_id);

-- crews ---------------------------------------------------------------------
create table crews.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 30),
  description text check (description is null or char_length(description) <= 140),
  avatar_path text,
  owner_id uuid not null references accounts.profiles (id),
  link_code text unique,
  status text not null default 'active' check (status in ('active', 'dissolved')),
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now()
);
create index crews_owner_idx on crews.crews (owner_id);

create table crews.members (
  crew_id uuid not null references crews.crews (id),
  user_id uuid not null references accounts.profiles (id),
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index members_user_idx on crews.members (user_id);
create unique index members_one_owner on crews.members (crew_id) where role = 'owner';

create table crews.selections (
  user_id uuid not null references accounts.profiles (id),
  crew_id uuid not null references crews.crews (id),
  primary key (user_id, crew_id)
);

-- live ----------------------------------------------------------------------
create table live.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references accounts.profiles (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_seen_at timestamptz not null default now(),
  platform text
);
create index sessions_user_idx on live.sessions (user_id);
create index sessions_open_idx on live.sessions (last_seen_at) where ended_at is null;

create table live.session_crews (
  session_id uuid not null references live.sessions (id) on delete cascade,
  crew_id uuid not null references crews.crews (id),
  primary key (session_id, crew_id)
);
create index session_crews_crew_idx on live.session_crews (crew_id);

create table live.segments (
  session_id uuid not null references live.sessions (id) on delete cascade,
  week_start date not null,
  max_speed_kmh real not null default 0,
  max_speed_at timestamptz,
  distance_m real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (session_id, week_start)
);
create index segments_week_idx on live.segments (week_start);
