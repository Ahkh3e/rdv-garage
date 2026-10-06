import { anonClient, corsHeaders, fail, json, serviceClient } from "../_shared/lib.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await anonClient().auth.getUser(token);
  if (authError || !auth.user) return fail("unauthenticated", 401);
  const uid = auth.user.id;

  const admin = serviceClient();

  // Steps 1-4 of the deletion path run in one database function.
  const { data: avatar, error } = await admin.schema("accounts").rpc("delete_account_data", { p_user: uid });
  if (error) {
    console.error("delete_account_data failed", error.message);
    return fail("deletion_failed", 500);
  }

  // Avatar files.
  const { data: files } = await admin.storage.from("avatars").list(uid);
  const paths = (files ?? []).map((f) => `${uid}/${f.name}`);
  if (typeof avatar === "string" && avatar && !paths.includes(avatar)) paths.push(avatar);
  if (paths.length > 0) await admin.storage.from("avatars").remove(paths);

  // Step 5: the auth user. The profile tombstone stays.
  const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
  if (deleteError) {
    console.error("deleteUser failed", deleteError.message);
    return fail("deletion_failed", 500);
  }
  return json({ ok: true });
});
