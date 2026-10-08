# Setup: everything you need to supply

The code is complete for 0.0.1. These are the accounts, keys, and one-time steps that only you can do. Nothing here needs code changes.

## Quickest path to a dev test

1. Local, no accounts needed: `docs/LOCAL_RUN.md` runs everything on two iOS simulators against a local Supabase.
2. On real phones: do sections 1 to 3 below with the **development** Supabase project (accounts auto-confirm, so no email provider is needed yet), build with `npx eas-cli build --profile preview --platform ios` (internal distribution; register each tester's iPhone first), and have testers sign up through an invite you create with the operator toolkit (`ops/README.md`).
3. Turn on SMTP (section 2, step 4) before anyone signs up in production mode.

## 1. Accounts

| Account | Why | Cost |
|---|---|---|
| Supabase | Database, auth, realtime, storage, functions | Free tier; two projects (development and production) |
| Apple Developer Program | iPhone builds, TestFlight, App Store | Paid, yearly |
| Expo (EAS) | Cloud builds. **Needed because Expo SDK 57 requires Xcode 26.4+ and this Mac has 16.4** | Free tier |
| Cloudflare | Hosts the link pages (Pages) and holds backups (R2) | Free tier |
| LiveKit Cloud | Walkie-talkie voice in chat rooms (decision 0027). Not needed until the `walkie` module is used | Free tier |
| Google Play Console | Android release (later) | One-time fee |
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
6. Database extensions: `pg_cron` must be enabled (Database, Extensions). The migration enables it where allowed. `pg_net` (walkie-talkie kicks) is enabled by the walkie migration, or enable it under the same menu first.
7. Create the read-only backup role: run `ops/scripts/backup-role.sql` once, with a real password.
8. Copy these three values (Project Settings, API Keys): project URL, publishable key (public), secret key (**private, full access**).

### Walkie-talkie voice (LiveKit)

1. Create a LiveKit Cloud project. In its settings keep recording and egress off. Copy the project URL (`wss://...`), an API key and its secret.
2. Generate two long random values: `openssl rand -hex 32` for the participant-id key and again for the kick secret.
3. Function secrets (never committed; the local copy lives in the git-ignored `supabase/functions/.env`, template in `supabase/functions/.env.example`):
   ```
   supabase secrets set LIVEKIT_URL=wss://<project>.livekit.cloud LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret> \
     WALKIE_IDENTITY_SECRET=<random one> WALKIE_KICK_SECRET=<random two>
   supabase functions deploy walkie_token walkie_kick
   ```
   `walkie_kick` is deployed without JWT verification (`supabase/config.toml`); it accepts only calls carrying `WALKIE_KICK_SECRET`.
4. Tell the database where the kick function is and the same secret, in the SQL editor (the values live in `private.settings`, which only the service role and the database can read):
   ```
   update private.settings set value = 'https://<project ref>.supabase.co/functions/v1/walkie_kick' where key = 'walkie_kick_url';
   update private.settings set value = '<random two>' where key = 'walkie_kick_secret';
   ```
   Until both are set, removals are queued but not sent, and a removed person's access ends when their 5-minute token does. The database sends the call with `pg_net` after the change commits and a one-minute job sends each call again while the person is still not allowed (so a rejoin with an old token is kicked again); `private.walkie_kicks` is that queue, and a row is dropped after 6 minutes or as soon as the person is allowed back.
5. Local development: `supabase/seed.sql` sets the local URL and a fake secret on `supabase db reset`. The local `.env` has fake LiveKit values, so token minting works and the kick call reaches `walkie_kick` but cannot reach LiveKit.
6. The app needs a new development build (new native modules, microphone and background audio entitlements). Expo Go and old development builds will not work.

## 3. The mobile app

1. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and fill `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY` (publishable key only), `EXPO_PUBLIC_LINK_DOMAIN`.
2. `cd apps/mobile && npx eas-cli login && npx eas-cli init` (sets the project id), then `npx eas-cli build --profile development --platform ios`.
3. Apple: in the Apple Developer account register the app id `app.rdvgarage.mobile` with the Associated Domains capability. EAS manages certificates for you when you log in.
4. Android (later): build with `--platform android`. The map needs no key (MapLibre with OpenFreeMap tiles). Add the app's SHA-256 signing fingerprint to the web build (below).
5. A development build is required. Expo Go will not work (background location, maps, voice).

### Notifications and the live indicator

- The live indicator is a **Live Activity** on iPhone (lock screen and Dynamic Island). It is built into the development build by the `expo-live-activity` plugin, needs iOS 16.2 or newer, and needs no keys. If a tester has turned off Live Activities for the app in Settings, an ordinary notification is used instead.
- On Android the indicator is the location service's foreground notification; no setup.
- Walkie-talkie: on iPhone a Live Activity shows "In a room" while you are in a room's channel; Live Activities have no button, so Leave is on the room screen. On Android a foreground service notification (Notifee) shows "In a room" with a Leave action, and needs the microphone foreground service permission that the config plugin adds. The iPhone `voip` background mode in `app.config.ts` is what the spec asks for; confirm it with Apple's review guidance before submission.
- Friend-goes-live notifications work while the app is running. A notification when the app is closed needs **push**: an Apple Push key and Firebase credentials registered with EAS, plus the server pieces in the spec repo's `docs/features/notifications.md`. That is not built yet.

## Install on your own iPhone with a free Apple ID

For the owner's own phone, with no paid Apple account. It builds a Release app (the JavaScript is embedded, so no Metro or Wi-Fi is needed to run it) that talks to the project named in `apps/mobile/.env`; the script prints a note, never the values.

Before the first run:

1. Phone: Settings, Privacy & Security, Developer Mode (bottom of the page), turn on, restart, then confirm Turn On and enter the passcode.
2. Mac: Xcode, Settings, Accounts, add your Apple ID. Open `apps/mobile/ios/RDVGarage.xcworkspace` once, select the RDVGarage target, Signing & Capabilities, and pick your Personal Team. (If the project does not exist yet, run the command below once; it stops at this step.)
3. Plug the phone in with a cable, unlock it, and tap Trust.
4. `apps/mobile/.env` has `EXPO_PUBLIC_SUPABASE_URL`.

Then, from the repo root:

```
scripts/install-ios-device.sh            # the one connected iPhone, or pass its name or UDID
scripts/install-ios-device.sh --dry-run  # checks and prints the steps, builds nothing
```

The script checks Xcode, the phone, Developer Mode and the team (`DEVELOPMENT_TEAM` if set, else your Apple Development certificate), generates the iOS project with `RDV_FREE_APPLE_ID=1`, builds, installs and launches. Run it again any time; it reuses the generated project and `--clean` regenerates it. If your free team cannot register `app.rdvgarage.mobile` (someone else owns it), set `RDV_BUNDLE_ID=app.rdvgarage.<yourname>`; the Live Activity extension follows (`<id>.LiveActivity`). The first launch may ask you to trust your Apple ID under Settings, General, VPN & Device Management.

What `RDV_FREE_APPLE_ID=1` changes: Associated Domains and the Push Notifications entitlement are left out, because a free team cannot provision either. Everything else stays: location, the microphone, background audio and voip modes, the Live Activity.

What the free account cannot do:

- Invite, crew and reset links do not open the app. Open the link in Safari, copy the code, and type it into the app.
- Remote push does not work. Friend-goes-live notifications arrive only while the app is running.
- The install expires after 7 days and the app stops opening. Reinstall by running the script again with the phone plugged in; your data lives on the server, so signing in again is enough.
- Every install goes over the cable, one phone at a time. There is no over-the-air sharing.
- A free team can create about 10 app ids per week, and each build with the Live Activity uses two (the app and `.LiveActivity`). Keep the same bundle id rather than changing it.

Reading a failure: the script prints `BLOCKED:` with the fix for each missing prerequisite. If the build fails, run it again and read the first `error:` line from `xcodebuild`; "No profiles" or "not registered" means the team or bundle id (pick the Personal Team in Xcode, or set `RDV_BUNDLE_ID`), "Communication with Apple failed" means Xcode is not signed in, and "device is locked" means unlock the phone and retry.

Android: `cd apps/mobile && npx expo run:android --variant release` with the phone's USB debugging on. No account is needed and the install does not expire.

## 4. Link pages (Cloudflare Pages)

1. Create a Pages project from this repo. Build command `node web/build.mjs`, output directory `web/dist`, environment variable `NODE_VERSION=24`.
2. Set these build variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APPLE_TEAM_ID`, `ANDROID_SHA256_FINGERPRINT`, `APP_STORE_URL`, `PLAY_STORE_URL`.
3. Attach your domain. Check `https://<domain>/.well-known/apple-app-site-association` returns JSON with no redirect.

## 5. The operator server

Follow `ops/README.md`. You need: the server (Node 22.13+, pnpm), `/etc/rdv-ops/env` with the service key, an `age` key pair (keep the private half away from the server), and a Cloudflare R2 bucket plus `rclone` configured for the off-server backup copy.

## 6. Before real people use it

- A lawyer reviews `DISCLAIMERS` in `packages/core/src/legal.ts` (also built into the link pages). Bump `TERMS_VERSION` when the text changes, and set the `terms_version` row in `private.settings` in the same change with a migration (the register function reads the setting). Signed-in people on an older version are asked to accept again.
- Run `ops/scripts/restore-check.sh` once against a scratch database.
- Confirm `AUTO_CONFIRM_EMAIL` is off and `ENVIRONMENT=production` on the production project.
- Store submission notes are in the spec repo (`docs/store-submission.md`): privacy policy, terms, Apple privacy labels, Play data safety, background location justification, and a reviewer account.
