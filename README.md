# RDV Garage

Referral-only social app for car enthusiasts: private crews, a shared live map, and a weekly top speed board. Built for the Toronto car scene. Release 0.0.1.

Specs, decisions, and issues live in [rdvgarage-spec](https://github.com/Ahkh3e/rdvgarage-spec). This repo is the implementation.

## Layout

| Path | What |
|---|---|
| `supabase/` | Postgres migrations, access policies, Edge Functions (`register`, `delete-account`, `change-password`) |
| `tests/` | Integration tests against the local Supabase stack |
| `packages/` | App modules: `core`, `referral`, `accounts`, `crews`, `map`, `live-location`, `leaderboard` |
| `apps/mobile/` | Expo app that wires the modules together (iPhone first, Android next) |
| `ops/` | Operator toolkit for the hosted Linux server (users, crews, simulation, backups) |
| `web/` | Static link pages for Cloudflare Pages (invites, confirmation, reset, deep-link files) |
| `docs/SETUP.md` | Every key and account you need to supply |

Status: release 0.0.1 is built and tested. See `docs/SETUP.md` for the keys and accounts you supply.

## Quick start

```
pnpm install
supabase start          # needs Docker
cp supabase/functions/.env.example supabase/functions/.env
supabase db reset
pnpm test:integration
```

## What is verified

- Backend: 49 integration tests against the local Supabase stack (access policies, registration in test and production mode, crews, live sessions, leaderboard, realtime channel authorization, account deletion, suspension, the operator toolkit including live simulation).
- App logic: the app's own Backend, engine, channel hub, receiver, and crew loader run against that stack.
- App: typechecks, bundles for iOS and Android with Metro.
- Not verified here: running on a device or simulator. Expo SDK 57 needs Xcode 26.4+ for local iOS builds; use EAS cloud builds (see `docs/SETUP.md`).
