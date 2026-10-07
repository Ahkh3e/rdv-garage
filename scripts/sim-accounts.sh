#!/usr/bin/env bash
# Makes the two local simulator accounts safe to sign in to and drive: real (not synthetic, so the fake-driver tool leaves
# them alone) and with a known local-only password. Local database only. usage: scripts/sim-accounts.sh [handle handle]
set -euo pipefail
PASSWORD="rdvsimpass12"
handles=("${@:-u3ff1e41c simub}")
list=$(printf "'%s'," ${handles[@]}); list=${list%,}
docker exec -i supabase_db_rdv-garage psql -U postgres -v ON_ERROR_STOP=1 <<SQL
update accounts.profiles set is_synthetic = false where handle in ($list);
update auth.users u set encrypted_password = extensions.crypt('$PASSWORD', extensions.gen_salt('bf'))
  from accounts.profiles p where p.id = u.id and p.handle in ($list);
select p.handle, u.email from accounts.profiles p join auth.users u on u.id = p.id where p.handle in ($list) order by p.handle;
SQL
echo "Local simulator password is set in this script (scripts/sim-accounts.sh)."
