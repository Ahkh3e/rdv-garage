#!/usr/bin/env bash
# Restores the newest backup into a scratch database and prints row counts. Never restore over production.
# Usage: AGE_IDENTITY=/path/to/age-key.txt SCRATCH_DATABASE_URL=postgresql://... ./restore-check.sh [dump.age]
set -euo pipefail
: "${AGE_IDENTITY:?path to the age private key}" "${SCRATCH_DATABASE_URL:?connection string of an empty scratch database}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/rdv}"
dump="${1:-$(ls -1t "$BACKUP_DIR"/rdv-*.dump.age | head -n 1)}"
echo "restoring $dump"
age -d -i "$AGE_IDENTITY" "$dump" | pg_restore --no-owner --no-privileges --clean --if-exists -d "$SCRATCH_DATABASE_URL" || true
psql "$SCRATCH_DATABASE_URL" -Atc "select 'profiles', count(*) from accounts.profiles union all select 'crews', count(*) from crews.crews union all select 'invites', count(*) from referral.invites union all select 'auth users', count(*) from auth.users"
