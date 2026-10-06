# Operator toolkit

Command line tools for the operator server, plus the scheduled jobs. Not exposed to the internet: there is no HTTP endpoint, route, or hidden app feature. Reaching it means SSH to the server. See `docs/ops.md` in the spec repo for the design.

The toolkit uses the Supabase service role key, which bypasses every access policy. Treat the server as the most sensitive thing you run.

## Install on the server

```
sudo useradd --system --create-home rdv-ops
sudo mkdir -p /opt/rdv-garage /var/log/rdv-ops /var/backups/rdv /etc/rdv-ops
git clone https://github.com/Ahkh3e/rdv-garage /opt/rdv-garage     # Node 22.13+ and pnpm
cd /opt/rdv-garage && pnpm install --filter @rdv/ops...
```

Config goes in `/etc/rdv-ops/env`, readable by root and the `rdv-ops` user only (`chmod 640`, `chown root:rdv-ops`). Copy `ops/env.example` and fill it in. Never commit it.

Audit log: `/var/log/rdv-ops/audit.log`, append-only:

```
sudo touch /var/log/rdv-ops/audit.log
sudo chown rdv-ops:rdv-ops /var/log/rdv-ops/audit.log
sudo chattr +a /var/log/rdv-ops/audit.log      # append-only; needs a filesystem that supports it
```

Server hardening that matters: key-only SSH, a firewall that allows only SSH in, unattended security updates, no other services on the box.

## Run

```
pnpm --filter @rdv/ops ops -- status
./ops/bin/rdv-ops user create --count 5 --credentials-file ./creds.jsonl
./ops/bin/rdv-ops crew create --members 4 --name "Night Run"
./ops/bin/rdv-ops sim live --crew <crew id> --users 4 --duration 300 --route highway
./ops/bin/rdv-ops sim leaderboard --crew <crew id> --previous-week
./ops/bin/rdv-ops purge-synthetic
```

Every command accepts `--dry-run`. In `production` every command except `user show`, `invite list`, and `status` also needs `--production` and the typed project name (`--confirm-project <name>`). Deleting a real crew needs `--confirm-name`.

| Command | What it does |
|---|---|
| `user create [--count N] [--invited-by h] [--credentials-file f]` | Synthetic users (`sim_xxxxxxxx`, `.invalid` email, confirmed). The deliberate exception to invite-gated signup |
| `user delete <handle>` / `--synthetic` | Full deletion path |
| `user suspend` / `restore <handle>` | Ban or unban, revoke invites |
| `user show <handle>` | Profile, referral chain, crews, invites |
| `invite list <handle>` / `invite disable <id>` | View or disable invites |
| `crew create [--owner h] [--members N] [--name n]` | Synthetic crew |
| `crew delete <id>` / `crew add` / `crew remove` | Crew changes |
| `sim live` | Fake drivers on the real realtime channels |
| `sim leaderboard` | Random segments for this week (and last) |
| `sim invites` | Referral chains |
| `purge-synthetic` | Remove every synthetic user and crew, nothing else |
| `status` | Counts and a database ping |

## Scheduled jobs

`scripts/crontab.example` installs the keep-alive and the backup.

- `scripts/ping.sh` calls a database function so there is real activity. Supabase does not promise this prevents a pause on the free plan; check its current rule.
- `scripts/backup.sh` dumps with the read-only `rdv_backup` role (`scripts/backup-role.sql`), encrypts with `age` to a public key whose private half is **not** on this server, keeps the newest 14, and copies to Cloudflare R2 with `rclone` when `RCLONE_REMOTE` is set.
- `scripts/restore-check.sh` restores the newest backup into a scratch database and prints counts. Do this once before you trust the backups.

Missing recent backup files in the bucket is the signal that something broke.

## Tests

`pnpm test` runs the unit tests. `pnpm test:integration` (needs `supabase start`) also runs the toolkit against a real local stack.
