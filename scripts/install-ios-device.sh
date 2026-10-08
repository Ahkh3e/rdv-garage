#!/usr/bin/env bash
# Installs a Release build on your own iPhone with a free Apple ID. See docs/SETUP.md.
# Usage: scripts/install-ios-device.sh [--dry-run] [--clean] [device name or UDID]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile="$root/apps/mobile"
derived=/private/tmp/rdv-dd-device
bundle_id="${RDV_BUNDLE_ID:-app.rdvgarage.mobile}"
dry=0
clean=0
target=""
blocked=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --clean) clean=1 ;;
    -h|--help) sed -n '2,3p' "${BASH_SOURCE[0]}" | sed 's/^# //'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) target="$arg" ;;
  esac
done

say() { printf '%s\n' "$*"; }
block() {
  printf 'BLOCKED: %s\n' "$*" >&2
  blocked=1
  [ "$dry" = 1 ] || exit 1
}
run() {
  if [ "$dry" = 1 ]; then printf 'would run: %s\n' "$*"; else "$@"; fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

xcodebuild -version >/dev/null 2>&1 || { say "BLOCKED: Xcode is not installed or not selected (xcode-select -s /Applications/Xcode.app)." >&2; exit 1; }
xcrun devicectl --version >/dev/null 2>&1 || { say "BLOCKED: xcrun devicectl is missing; update Xcode." >&2; exit 1; }
command -v node >/dev/null || { say "BLOCKED: node is required." >&2; exit 1; }
say "xcode: $(xcodebuild -version | head -1)"

xcrun devicectl list devices --json-output "$tmp/devices.json" >/dev/null 2>&1 || { say "BLOCKED: devicectl could not list devices." >&2; exit 1; }
matches="$(TARGET="$target" node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1])).result.devices;
const t = process.env.TARGET;
const phys = d.filter((x) => x.hardwareProperties.platform === "iOS" && x.connectionProperties.transportType !== "sameMachine");
const hit = t ? phys.filter((x) => x.deviceProperties.name === t || x.hardwareProperties.udid === t || x.identifier === t) : phys;
for (const x of hit) console.log([x.hardwareProperties.udid, x.identifier, x.deviceProperties.name, x.hardwareProperties.marketingName || x.hardwareProperties.productType, x.connectionProperties.tunnelState].join("\t"));
' "$tmp/devices.json")"
count="$(printf '%s' "$matches" | grep -c . || true)"
if [ "$count" = 0 ]; then
  say "BLOCKED: no physical iPhone found${target:+ matching \"$target\"}. Plug it in with a cable, unlock it, tap Trust, then retry." >&2
  exit 1
fi
if [ "$count" -gt 1 ]; then
  say "Several devices match:" >&2
  printf '%s\n' "$matches" | cut -f1,3 | sed 's/^/  /' >&2
  say "BLOCKED: pass the device name or UDID as the argument." >&2
  exit 1
fi
IFS=$'\t' read -r udid ident dname dmodel tunnel <<<"$matches"
say "device: $dname ($dmodel) $udid, $tunnel"
if [ "$tunnel" != "connected" ]; then
  block "$dname is $tunnel. Plug it in with a cable, unlock it and keep it awake, tap Trust if asked, then retry."
fi

dev_mode="unknown"
if xcrun devicectl device info details --device "$ident" --json-output "$tmp/details.json" >/dev/null 2>&1; then
  dev_mode="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).result.deviceProperties.developerModeStatus || "unknown")' "$tmp/details.json")"
fi
if [ "$dev_mode" = "enabled" ]; then
  say "developer mode: enabled"
elif [ "$dev_mode" = "unknown" ]; then
  say "developer mode: could not be read (the phone is not reachable yet)"
else
  block "Developer Mode is $dev_mode on $dname. On the phone: Settings, Privacy & Security, scroll to the bottom, Developer Mode, turn it on, restart when asked, then confirm Turn On after the restart and enter the passcode."
fi

team="${DEVELOPMENT_TEAM:-}"
if [ -z "$team" ]; then
  name="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | sort -u)"
  if [ -n "$name" ]; then
    teams="$(printf '%s\n' "$name" | while read -r n; do
      security find-certificate -a -c "$n" -p 2>/dev/null | openssl x509 -noout -subject -nameopt multiline 2>/dev/null | sed -n 's/^ *organizationalUnitName *= *//p'
    done | sort -u | grep -v '^$' || true)"
    if [ "$(printf '%s' "$teams" | grep -c .)" = 1 ]; then team="$teams"; elif [ -n "$teams" ]; then say "several Apple Development teams found, set DEVELOPMENT_TEAM to one of: $(printf '%s' "$teams" | tr '\n' ' ')" >&2; fi
  fi
fi
if [ -z "$team" ]; then
  team="$(defaults read com.apple.dt.Xcode IDEProvisioningTeamManagerCachedTeams 2>/dev/null | sed -n 's/.*teamID = "\{0,1\}\([A-Z0-9]\{10\}\).*/\1/p' | sort -u | head -1 || true)"
fi
if [ -z "$team" ]; then
  block "no development team found. In Xcode: Settings, Accounts, + , Apple ID, sign in. Then open apps/mobile/ios/RDVGarage.xcworkspace once, select the RDVGarage target, Signing & Capabilities, and pick your Personal Team. Run this script again (or set DEVELOPMENT_TEAM=<team id>)."
  team="<team id>"
fi
say "team: $team"

env_file="$mobile/.env"
if ! grep -q '^EXPO_PUBLIC_SUPABASE_URL=.\+' "$env_file" 2>/dev/null; then
  block "$env_file is missing EXPO_PUBLIC_SUPABASE_URL (copy .env.example and fill it)."
else
  say "note: the build embeds the values in apps/mobile/.env (the hosted project); they are not printed."
fi

if [ "$blocked" = 1 ]; then say "dry run: the checks above would stop a real run."; fi

export RDV_FREE_APPLE_ID=1
export RDV_BUNDLE_ID="$bundle_id"
marker="$mobile/ios/.rdv-free-apple-id"
want="free:$bundle_id"
prebuild=(npx expo prebuild --platform ios)
if [ "$clean" = 1 ] || [ ! -d "$mobile/ios" ] || [ "$(cat "$marker" 2>/dev/null || true)" != "$want" ]; then
  [ -d "$mobile/ios" ] && prebuild+=(--clean)
fi
say "bundle id: $bundle_id (extension $bundle_id.LiveActivity)"
if [ "$dry" = 1 ]; then
  say "would run (in apps/mobile): RDV_FREE_APPLE_ID=1 RDV_BUNDLE_ID=$bundle_id ${prebuild[*]}"
else
  (cd "$mobile" && "${prebuild[@]}")
  echo "$want" >"$marker"
fi

app="$derived/Build/Products/Release-iphoneos/RDVGarage.app"
run xcodebuild -workspace "$mobile/ios/RDVGarage.xcworkspace" -scheme RDVGarage -configuration Release \
  -destination "id=$udid" -allowProvisioningUpdates "DEVELOPMENT_TEAM=$team" -derivedDataPath "$derived"
run xcrun devicectl device install app --device "$ident" "$app"
run xcrun devicectl device process launch --device "$ident" --terminate-existing "$bundle_id"

if [ "$dry" = 1 ]; then
  [ "$blocked" = 0 ] || exit 1
  say "dry run complete; nothing was built or installed."
else
  say "installed and launched $bundle_id on $dname. If it will not open: Settings, General, VPN & Device Management, trust your Apple ID."
fi
