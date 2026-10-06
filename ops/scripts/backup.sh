#!/usr/bin/env bash
# Encrypted database backup. Uses the read-only rdv_backup role, never the service key.
# Needs: pg_dump (same major version as the database), age, and optionally rclone for the off-server copy.
#
# /etc/rdv-ops/backup.env must define:
#   BACKUP_DATABASE_URL   postgresql://rdv_backup:...@db.<ref>.supabase.co:5432/postgres
#   AGE_RECIPIENT         the age public key the dumps are encrypted to (keep the private key off this server)
# Optional:
#   BACKUP_DIR (default /var/backups/rdv), RETENTION_COUNT (default 14),
#   RCLONE_REMOTE (for example r2:rdv-backups) for the off-server copy.
set -euo pipefail
ENV_FILE="${RDV_BACKUP_ENV_FILE:-/etc/rdv-ops/backup.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL missing}" "${AGE_RECIPIENT:?AGE_RECIPIENT missing}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/rdv}"
RETENTION_COUNT="${RETENTION_COUNT:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/rdv-$stamp.dump.age"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

# App schemas plus auth (users and password hashes) and storage metadata, so a restore brings accounts back.
pg_dump "$BACKUP_DATABASE_URL" --format=custom --no-owner --no-privileges \
  --schema=accounts --schema=referral --schema=crews --schema=live --schema=leaderboard --schema=private \
  --schema=auth --schema=storage --schema=public \
  | age -r "$AGE_RECIPIENT" -o "$tmp"
mv "$tmp" "$out"
chmod 600 "$out"
sha256sum "$out" > "$out.sha256" 2>/dev/null || shasum -a 256 "$out" > "$out.sha256"

# Keep the newest RETENTION_COUNT dumps.
ls -1t "$BACKUP_DIR"/rdv-*.dump.age 2>/dev/null | tail -n +"$((RETENTION_COUNT + 1))" | while read -r old; do rm -f "$old" "$old.sha256"; done

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copyto "$out" "$RCLONE_REMOTE/$(basename "$out")"
  rclone copyto "$out.sha256" "$RCLONE_REMOTE/$(basename "$out").sha256"
fi
echo "$(date -u +%FT%TZ) backup ok: $(basename "$out") ($(wc -c < "$out") bytes)"
