import { anonClient, corsHeaders, fail, json, serviceClient, sessionIdFromJwt } from "../_shared/lib.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await anonClient().auth.getUser(token);
  if (authError || !auth.user?.email) return fail("unauthenticated", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_request");
  }
  const current = String(body.current ?? "");
  const next = String(body.next ?? "");
  if (next.length < 8) return fail("password_too_short");

  const admin = serviceClient();
  const { error: limitError } = await admin.schema("accounts").rpc("rate_limit", {
    p_key: `change_password:${auth.user.id}`,
    p_max: 10,
    p_window_seconds: 3600,
  });
  if (limitError) return fail("rate_limited", 429);

  // Verify the current password with a throwaway sign-in, then discard that session.
  const checker = anonClient();
  const { data: verified, error: verifyError } = await checker.auth.signInWithPassword({
    email: auth.user.email,
    password: current,
  });
  if (verifyError || !verified.session) return fail("wrong_password");
  const tempSession = sessionIdFromJwt(verified.session.access_token);
  if (tempSession) await admin.schema("accounts").rpc("revoke_sessions_except", { p_user: auth.user.id, p_keep: sessionIdFromJwt(token) });
  else await admin.auth.admin.signOut(verified.session.access_token, "local");

  const { error: updateError } = await admin.auth.admin.updateUserById(auth.user.id, { password: next });
  if (updateError) return fail("password_too_short");

  // Changing a password can end the caller's own session too. Sign in again with the new password,
  // hand that fresh session back to the app, and sign out every other device.
  const fresh = await anonClient().auth.signInWithPassword({ email: auth.user.email, password: next });
  if (fresh.error || !fresh.data.session) return fail("unknown_error", 500);
  await admin.schema("accounts").rpc("revoke_sessions_except", {
    p_user: auth.user.id,
    p_keep: sessionIdFromJwt(fresh.data.session.access_token),
  });
  return json({
    ok: true,
    session: { access_token: fresh.data.session.access_token, refresh_token: fresh.data.session.refresh_token },
  });
});
