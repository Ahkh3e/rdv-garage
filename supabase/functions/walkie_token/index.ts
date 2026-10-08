import { anonClient, corsHeaders, fail, json, serviceClient } from "../_shared/lib.ts";
import { issueToken, rpcFailure } from "./handler.ts";

const livekitUrl = Deno.env.get("LIVEKIT_URL");
const apiKey = Deno.env.get("LIVEKIT_API_KEY");
const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");

// The token names one room by its opaque id and carries an opaque participant id: no handle, crew or location.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await anonClient().auth.getUser(jwt);
  if (authError || !auth.user) return fail("unauthenticated", 401);

  const service = serviceClient();
  const limit = await service.schema("accounts").rpc("rate_limit", {
    p_key: `walkie_token:${auth.user.id}`,
    p_max: 240,
    p_window_seconds: 3600,
  });
  const denied = rpcFailure(limit.error);
  if (denied) return json(denied.body, denied.status);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_request");
  }
  const outcome = await issueToken(body, auth.user.id, {
    livekit: livekitUrl && apiKey && apiSecret ? { url: livekitUrl, apiKey, apiSecret } : null,
    identitySecret: Deno.env.get("WALKIE_IDENTITY_SECRET") ?? null,
    async access(roomId, userId) {
      const { data, error } = await service.schema("chat").rpc("walkie_access", { p_room: roomId, p_user: userId });
      return error ? null : data;
    },
    now: () => Math.floor(Date.now() / 1000),
  });
  return json(outcome.body, outcome.status);
});
