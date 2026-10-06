#!/usr/bin/env bash
# Keep-alive: real database activity so a free Supabase project is not paused for inactivity.
# Reads SUPABASE_URL and SUPABASE_ANON_KEY from /etc/rdv-ops/env (or the file in RDV_OPS_ENV_FILE).
set -euo pipefail
ENV_FILE="${RDV_OPS_ENV_FILE:-/etc/rdv-ops/env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
: "${SUPABASE_URL:?SUPABASE_URL missing}" "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY missing}"
result="$(curl -fsS -X POST "$SUPABASE_URL/rest/v1/rpc/ping" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{}')"
[ "$result" = '"ok"' ] || { echo "ping failed: $result" >&2; exit 1; }
echo "$(date -u +%FT%TZ) ping ok"
