import { anonClient, corsHeaders, fail, json, pgCode, serviceClient } from "../_shared/lib.ts";
import { insideRadius, insideWindow, parseRequest } from "./arrival.ts";

// The reading is compared with the RDV place here and dropped. It is never passed to the database, logged or returned,
// so only the fact of arrival (who, which RDV, when, how) is stored.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await anonClient().auth.getUser(token);
  if (authError || !auth.user) return fail("unauthenticated", 401);
  const uid = auth.user.id;

  const admin = serviceClient();
  const limit = await admin.schema("accounts").rpc("rate_limit", { p_key: `record_arrival:${uid}`, p_max: 30, p_window_seconds: 3600 });
  if (limit.error) return fail("rate_limited", 429);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_request");
  }
  const request = parseRequest(body);
  body = null;
  if (!request) return fail("invalid_request");

  const target = await admin.schema("rdvs").rpc("arrival_target", { p_user: uid, p_rdv: request.rdvId });
  if (target.error || !target.data) return fail("rdv_not_found", 404);
  const t = target.data as { lat: number; lng: number; radius_m: number; status: string; starts_at: string; end_at: string; arrived: boolean };

  if (t.arrived) return json({ recorded: true, already: true });
  if (t.status !== "scheduled") return fail("rdv_closed", 409);
  if (!insideWindow(Date.now(), Date.parse(t.starts_at), Date.parse(t.end_at))) return fail("outside_window", 409);
  if (!insideRadius(request.reading, t, t.radius_m)) return fail("outside_radius", 409);

  const stored = await admin.schema("rdvs").rpc("store_arrival", { p_user: uid, p_rdv: request.rdvId, p_method: request.method });
  if (stored.error) {
    const code = pgCode(stored.error);
    return fail(code, code === "unknown_error" ? 500 : 409);
  }
  return json({ recorded: true, already: stored.data === false });
});
