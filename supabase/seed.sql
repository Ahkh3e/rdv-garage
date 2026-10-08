-- Local development only (runs on supabase db reset). Hosted projects set these by hand; see docs/SETUP.md.
update private.settings set value = 'http://supabase_kong_rdv-garage:8000/functions/v1/walkie_kick' where key = 'walkie_kick_url';
update private.settings set value = 'local-fake-kick-secret-0123456789abcdef' where key = 'walkie_kick_secret';
