#!/usr/bin/env bash
# Fake drivers on the local backend, moving through the real realtime channels so movement trails show up on the map.
# usage: scripts/sim-drive.sh <crew id> [users=3] [seconds=3600] [route=city|highway]
set -euo pipefail
crew="${1:?crew id required}"
users="${2:-3}"
seconds="${3:-3600}"
route="${4:-city}"
cd "$(dirname "$0")/.."
eval "$(supabase status -o env | sed 's/^/export /')"
export OPS_ENVIRONMENT=development
export SUPABASE_URL="$API_URL"
export SUPABASE_ANON_KEY="${PUBLISHABLE_KEY:-$ANON_KEY}"
export SUPABASE_SERVICE_ROLE_KEY="${SECRET_KEY:-$SERVICE_ROLE_KEY}"
export OPS_AUDIT_LOG="${TMPDIR:-/tmp}/rdv-ops-audit.log"
exec node ops/bin/rdv-ops.mjs sim live --crew "$crew" --users "$users" --duration "$seconds" --route "$route"
