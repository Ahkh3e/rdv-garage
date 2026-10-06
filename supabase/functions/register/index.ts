import { anonClient, clientIp, corsHeaders, environment, fail, json, pgCode, serviceClient, testModeEnabled } from "../_shared/lib.ts";

const HANDLE = /^[a-z0-9_]{3,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_request");
  }

  const inviteCode = String(body.invite_code ?? "").trim();
  const handle = String(body.handle ?? "").trim().toLowerCase();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const termsVersion = String(body.terms_version ?? "");
  const ageConfirmed = body.age_confirmed === true;

  const admin = serviceClient();

  // Per-address limit first, on every request. The per-email limit comes later and only counts requests that
  // got this far, so someone else's garbage requests cannot lock a person's email out of registering.
  const limit = await admin.schema("accounts").rpc("rate_limit", { p_key: `register:${clientIp(req)}`, p_max: 60, p_window_seconds: 3600 });
  if (limit.error) return fail(pgCode(limit.error), 429);

  if (!HANDLE.test(handle)) return fail("handle_invalid");
  if (!EMAIL.test(email) || email.length > 254) return fail("email_invalid");
  if (password.length < 8) return fail("password_too_short");
  const { data: currentTerms } = await admin.schema("accounts").rpc("current_terms_version");
  if (termsVersion !== currentTerms) return fail("terms_required");
  if (!ageConfirmed) return fail("age_confirmation_required");

  const { data: invite, error: inviteError } = await admin.schema("referral").rpc("validate_for_register", { p_code: inviteCode });
  if (inviteError || !invite?.[0]) return fail(pgCode(inviteError));
  const { invite_id, inviter_id } = invite[0];

  const { data: validHandle } = await admin.schema("accounts").rpc("handle_valid", { p_handle: handle });
  if (!validHandle) return fail("handle_invalid");
  const { data: available } = await admin.schema("accounts").rpc("handle_available", { p_handle: handle });
  if (!available) return fail("handle_taken");

  const emailLimit = await admin.schema("accounts").rpc("rate_limit", { p_key: `register_email:${email}`, p_max: 5, p_window_seconds: 3600 });
  if (emailLimit.error) return fail(pgCode(emailLimit.error), 429);

  const testMode = testModeEnabled();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: testMode,
  });

  if (createError || !created?.user) {
    const exists = createError?.code === "email_exists" || /already|registered|exists/i.test(createError?.message ?? "");
    if (exists) {
      if (testMode) return fail("email_in_use");
      // Same answer as a new account. The email says an account exists and lets the owner reset the password.
      await anonClient().auth.resetPasswordForEmail(email, { redirectTo: `${Deno.env.get("SITE_URL") ?? ""}/reset` });
      return json({ status: "check_email" });
    }
    console.error("createUser failed", createError?.message);
    return fail("registration_failed", 500);
  }

  const { error: profileError } = await admin.schema("accounts").rpc("create_profile", {
    p_id: created.user.id,
    p_handle: handle,
    p_invited_by: inviter_id,
    p_invite_id: invite_id,
    p_terms_version: termsVersion,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(pgCode(profileError));
  }

  if (testMode) return json({ status: "confirmed" });

  const { error: resendError } = await anonClient().auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${Deno.env.get("SITE_URL") ?? ""}/confirm` },
  });
  if (resendError) {
    console.error(`[${environment()}] confirmation email failed`, resendError.message);
    await admin.schema("accounts").rpc("delete_account_data", { p_user: created.user.id });
    await admin.auth.admin.deleteUser(created.user.id);
    return fail("registration_failed", 500);
  }
  return json({ status: "check_email" });
});
