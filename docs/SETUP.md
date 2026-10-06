# Setup: everything you need to supply

The code is complete for 0.0.1. These are the accounts, keys, and one-time steps that only you can do. Nothing here needs code changes.

## 1. Accounts

| Account | Why | Cost |
|---|---|---|
| Supabase | Database, auth, realtime, storage, functions | Free tier; two projects (development and production) |
| Apple Developer Program | iPhone builds, TestFlight, App Store | Paid, yearly |
| Expo (EAS) | Cloud builds. **Needed because Expo SDK 57 requires Xcode 26.4+ and this Mac has 16.4** | Free tier |
| Cloudflare | Hosts the link pages (Pages) and holds backups (R2) | Free tier |
| Google Play Console | Android release (later) | One-time fee |
| Google Cloud | A Maps SDK for Android key, only when Android ships | Free for map display |
| A domain | Invite and reset links. A `pages.dev` address works to start but a domain is better for universal links | About $10/year |
| An email sender (SMTP) | Confirmation and password reset emails in production. Resend, Brevo, or similar | Free tier |

## 2. Supabase (production project, Canada Central)

1. Create the project in the Canada (Central) region. Create a second one for development.
2. `supabase link --project-ref <ref>` then `supabase db push` to apply `supabase/migrations`.
3. Auth settings: signups **disabled** (the config file does this locally; set it in the dashboard for hosted), email confirmations **on**, minimum password length 8, site URL `https://<link domain>`, and redirect URLs `https://<link domain>/**` and `rdvgarage://**`.
4. Auth, SMTP: enter your SMTP provider's host, port, user, password, and sender address. Without this, confirmation and reset emails do not reach real people.
5. Function secrets:
   ```
   supabase secrets set ENVIRONMENT=production AUTO_CONFIRM_EMAIL=false SITE_URL=https://<link domain>
   supabase functions deploy register delete-account change-password
   ```
   For the development project use `ENVIRONMENT=development AUTO_CONFIRM_EMAIL=true`. **Never set `AUTO_CONFIRM_EMAIL=true` in production**; the function ignores it there and logs an error, but keep it off.
6. Database extensions: `pg_cron` must be enabled (Database, Extensions). The migration enables it where allowed.
7. Create the read-only backup role: run `ops/scripts/backup-role.sql` once, with a real password.
8. Copy these three values (Project Settings, API Keys): project URL, publishable key (public), secret key (**private, full access**).

## 3. The mobile app

1. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and fill `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY` (publishable key only), `EXPO_PUBLIC_LINK_DOMAIN`.
2. `cd apps/mobile && npx eas-cli login && npx eas-cli init` (sets the project id), then `npx eas-cli build --profile development --platform ios`.
3. Apple: in the Apple Developer account register the app id `app.rdvgarage.mobile` with the Associated Domains capability. EAS manages certificates for you when you log in.
4. Android (later): set `GOOGLE_MAPS_API_KEY` as an EAS secret, then build with `--platform android`. Add the app's SHA-256 signing fingerprint to the web build (below).
5. A development build is required. Expo Go will not work (background location, maps).

## 4. Link pages (Cloudflare Pages)

1. Create a Pages project from this repo. Build command `node web/build.mjs`, output directory `web/dist`, environment variable `NODE_VERSION=24`.
2. Set these build variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APPLE_TEAM_ID`, `ANDROID_SHA256_FINGERPRINT`, `APP_STORE_URL`, `PLAY_STORE_URL`.
3. Attach your domain. Check `https://<domain>/.well-known/apple-app-site-association` returns JSON with no redirect.

## 5. The operator server

Follow `ops/README.md`. You need: the server (Node 22.13+, pnpm), `/etc/rdv-ops/env` with the service key, an `age` key pair (keep the private half away from the server), and a Cloudflare R2 bucket plus `rclone` configured for the off-server backup copy.

## 6. Before real people use it

- A lawyer reviews `DISCLAIMERS` in `packages/core/src/legal.ts` (also built into the link pages). Bump `TERMS_VERSION` when the text changes (also in `supabase/functions/register/index.ts`).
- Run `ops/scripts/restore-check.sh` once against a scratch database.
- Confirm `AUTO_CONFIRM_EMAIL` is off and `ENVIRONMENT=production` on the production project.
- Store submission notes are in the spec repo (`docs/store-submission.md`): privacy policy, terms, Apple privacy labels, Play data safety, background location justification, and a reviewer account.
