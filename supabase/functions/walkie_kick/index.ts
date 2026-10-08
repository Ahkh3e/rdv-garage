import { corsHeaders, fail, json } from "../_shared/lib.ts";
import { relayAdmin } from "../_shared/walkie.ts";
import { kick } from "./handler.ts";

const relayUrl = Deno.env.get("WALKIE_RELAY_URL");
const relaySecret = Deno.env.get("WALKIE_RELAY_SECRET");
const relayAdminSecret = Deno.env.get("WALKIE_RELAY_ADMIN_SECRET");

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
    admin: relayUrl && relaySecret && relayAdminSecret ? relayAdmin({ url: relayUrl, secret: relaySecret, adminSecret: relayAdminSecret }) : null,
  });
  return json(outcome.body, outcome.status);
});
