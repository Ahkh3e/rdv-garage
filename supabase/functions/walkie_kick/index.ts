import { corsHeaders, fail, json } from "../_shared/lib.ts";
import { liveKitAdmin } from "../_shared/walkie.ts";
import { kick } from "./handler.ts";

const livekitUrl = Deno.env.get("LIVEKIT_URL");
const apiKey = Deno.env.get("LIVEKIT_API_KEY");
const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const outcome = await kick(req.headers.get("x-walkie-secret"), body, {
    sharedSecret: Deno.env.get("WALKIE_KICK_SECRET") ?? null,
    identitySecret: Deno.env.get("WALKIE_IDENTITY_SECRET") ?? null,
    admin: livekitUrl && apiKey && apiSecret ? liveKitAdmin({ url: livekitUrl, apiKey, apiSecret }) : null,
  });
  return json(outcome.body, outcome.status);
});
