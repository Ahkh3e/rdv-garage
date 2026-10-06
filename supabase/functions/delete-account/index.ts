import { anonClient, corsHeaders, fail, json, serviceClient } from "../_shared/lib.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await anonClient().auth.getUser(token);
  if (authError || !auth.user) return fail("unauthenticated", 401);
  const uid = auth.user.id;

  const admin = serviceClient();

  // Avatar files first. Listing and removing is repeatable, so a failure here leaves the account untouched and the
  // person can simply try again.
  const paths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data: files, error } = await admin.storage.from("avatars").list(uid, { limit: 100, offset });
    if (error) {
      console.error("avatar list failed", error.message);
      return fail("deletion_failed", 500);
    }
    if (!files || files.length === 0) break;
    paths.push(...files.map((f) => `${uid}/${f.name}`));
    if (files.length < 100) break;
  }
  if (paths.length > 0) {
    const { error } = await admin.storage.from("avatars").remove(paths);
    if (error) {
      console.error("avatar remove failed", error.message);
      return fail("deletion_failed", 500);
    }
  }

  // Steps 1-4 of the deletion path run in one database function. Running it again is harmless.
  const { error } = await admin.schema("accounts").rpc("delete_account_data", { p_user: uid });
  if (error) {
    console.error("delete_account_data failed", error.message);
    return fail("deletion_failed", 500);
  }

  // Step 5: the auth user. The profile tombstone stays.
  const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
  if (deleteError) {
    console.error("deleteUser failed", deleteError.message);
    return fail("deletion_failed", 500);
  }
  return json({ ok: true });
});
