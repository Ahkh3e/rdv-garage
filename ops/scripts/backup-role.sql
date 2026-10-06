-- Run once as the database owner. A read-only role for backups, so a lost backup credential cannot change data.
create role rdv_backup login password 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
grant pg_read_all_data to rdv_backup;
-- It can read everything (including auth.users) and write nothing.
