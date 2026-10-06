# Local run plan

Run the whole product on one Mac: backend, link pages, operator toolkit, and the app in two iPhone simulators. This is the plan and the test script. It does not replace a device test (see the end).

## 1. Preconditions

| Need | Check |
|---|---|
| Xcode 26.4 or newer (Expo SDK 57) | `xcodebuild -version` |
| An iOS simulator runtime that matches it | `xcrun simctl list runtimes` |
| Docker running | `docker ps` |
| Node 22.13+ and pnpm | `node -v`, `pnpm -v` |
| About 30 GB free disk | `df -h /` |

## 2. Bring-up

1. **Backend.** `supabase start`, then `cp supabase/functions/.env.example supabase/functions/.env` (test mode, so no email provider is needed) and, for a clean database, `supabase db reset`. If functions return 503, run `supabase stop && supabase start`.
2. **Keys.** `supabase status -o env` gives `PUBLISHABLE_KEY` (for the app and the web pages) and the service key (for the operator toolkit only).
3. **Link pages.** `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=<publishable key> node web/build.mjs && node web/dev-server.mjs` serves them on `http://127.0.0.1:8788`.
4. **Operator toolkit.** Write an env file with `OPS_ENVIRONMENT=development`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPS_AUDIT_LOG=./ops-audit.log`, then `export RDV_OPS_ENV_FILE=<that file>` and run `./ops/bin/rdv-ops.mjs status`.
5. **App.** From `apps/mobile`:
   ```
   export EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   export EXPO_PUBLIC_SUPABASE_KEY=<publishable key>
   export EXPO_PUBLIC_LINK_DOMAIN=127.0.0.1:8788
   npx expo run:ios --device "<simulator name>"
   ```
   The first build compiles native code and installs pods; later runs reuse it. Use `npx expo start --dev-client` for Metro afterwards.
6. **Second phone.** Boot a second simulator, install the same build (`xcrun simctl install <udid> <app path>`), and point it at the same Metro. Two simulators are two members.

Local link note: the simulators open `rdvgarage://` links directly. Universal links need a real domain, so locally use `xcrun simctl openurl booted "rdvgarage://i/<CODE>"`.

## 3. Simulating a drive

- Simulator menu, Features, Location: City Run, Freeway Drive, Custom Location. Or `xcrun simctl location <udid> run city-run` and `xcrun simctl location <udid> set 43.6532,-79.3832`.
- A route at a chosen speed: `xcrun simctl location <udid> start --speed=19 <lat,lng> <lat,lng> ...` (metres per second; 19 is about 68 km/h). The follow camera and the weekly top speed both respond to it.
- Fake members: `./ops/bin/rdv-ops.mjs sim live --crew <crew id> --users 3 --duration 180 --route highway`.
- Simulator background location is limited, so lock-screen behavior is a device test, not a simulator one.

## 4. Scenarios (pass or fail each)

Record a screenshot (`xcrun simctl io booted screenshot <file>`) and a note per scenario.

**A. Join by invite**
1. Create the first account with the operator toolkit: `user create --credentials-file creds.jsonl` (the founder). Sign in on phone 1 with those credentials (email and password from the file).
2. Me, Share invite: create an invite and read the code. Open `http://127.0.0.1:8788/i/<CODE>` in the Mac browser: valid page.
3. Phone 2: open the link with `xcrun simctl openurl <udid2> "rdvgarage://i/<CODE>"`. Welcome shows "Invite found". Create the account (handle, email, password, tick both boxes). Test mode confirms it and signs in.
4. Invite shows the new member under "Joined".
5. Negative: expired code (wait or `ops invite disable`), revoked code, mistyped code, weak password, taken handle. Each shows the right message.

**B. Email flows (production mode)**
1. Set `ENVIRONMENT=production` in `supabase/functions/.env`, `supabase stop && supabase start`.
2. Register: Confirm email screen, mail in the catcher at `http://127.0.0.1:54324`, confirmation link, then sign in. Resend works.
3. Forgot password: request on phone, open the mailed link, the app shows the new password screen; other devices are signed out afterwards.
4. Restore test mode afterwards.

**C. Crews**
Create a crew on phone 1, share the crew link, join from phone 2 with `rdvgarage://c/<CODE>`. Selection toggles, member list, owner actions (remove, transfer, regenerate link, delete), leave.

**D. Map and live**
1. Both phones: switch the crew on. Phone 1: Go live, pick the crew, accept permissions, run City Run. Phone 2 sees phone 1 move.
2. Stop on phone 1: it disappears from phone 2 at once.
3. Park phone 1 (stop the simulated drive): it stays on phone 2's map.
4. Leave the crew on phone 1 while live: sharing with it stops.
5. Run `sim live` with fake members: they appear, move, then vanish after `stop`.

**E. Leaderboard**
After a drive and a `sim live --route highway`, the Board lists everyone in km/h with the disclaimer; your row is highlighted. `sim leaderboard --previous-week` adds data without changing this week's board.

**F. Account safety**
Devices lists both sessions and revokes one. Change password signs out the other phone. `ops user suspend <handle>` signs that phone out with the suspended message; `restore` lets them back. Delete account: the crew passes to the other member or disappears, the referral chain stays.

**G. Resilience**
Stop the backend with the app open: waiting screen, not a sign out. Start it again: recovers on its own.

**H. Modules**
Set `EXPO_PUBLIC_FLAGS='{"leaderboard":false}'`, rebuild the JS: the Board tab is gone and nothing else changes.

## 5. Capture and triage

- Logs: `xcrun simctl spawn booted log stream --predicate 'subsystem contains "com.apple"' | head` for system, Metro output for JS errors, `supabase functions logs` equivalents via `docker logs` for the edge runtime.
- Each failure: reproduce, write a failing test first when it is logic, fix, rerun the suites (`pnpm typecheck`, `pnpm test`, `pnpm test:integration`).
- Visual issues (spacing, contrast, truncation, safe areas, keyboard overlap) are fixed against `docs/design.md` in the spec repo.

## 6. Exit

All scenarios A to H pass on two simulators, screenshots saved, suites green, and every defect either fixed or filed as an issue.

## 7. Not covered here

Real background location (screen locked, battery), the Android app, push, store review behavior, real email delivery, universal link verification on a real domain. These need a phone and the accounts in `docs/SETUP.md`.

## 8. If the build fails

- Pod or Swift version errors: confirm the Xcode version and run `xcode-select -p`.
- Metro cannot reach the backend from the simulator: use `127.0.0.1` (shared with the Mac); a phone on Wi-Fi needs the Mac's LAN address.
- Map blank on iOS: the map is MapLibre with OpenFreeMap tiles and needs no key; check the simulator has network access.
- JS changes do not show up on the simulator: restart Metro with `npx expo start --dev-client --clear`, then reopen `app.rdvgarage.mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081` on each simulator. Native changes (a new native library) need a rebuild.
- Last resort for seeing screens without a native build: a browser preview target with a stubbed map (not the real app).
