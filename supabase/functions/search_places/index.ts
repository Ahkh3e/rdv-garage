import { anonClient, corsHeaders, fail, json, serviceClient } from "../_shared/lib.ts";
import { cleanText, parseBias, parsePhoton, photonUrl } from "./photon.ts";

const PHOTON_URL = Deno.env.get("PHOTON_URL") ?? "https://photon.komoot.io";

// Forwards only the typed text and a coarse bias point. No account, crew, handle or address of the caller reaches
// the geocoder, and nothing about the search is stored.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await anonClient().auth.getUser(token);
  if (authError || !auth.user) return fail("unauthenticated", 401);

  const limit = await serviceClient().schema("accounts").rpc("rate_limit", {
    p_key: `search_places:${auth.user.id}`,
    p_max: 600,
    p_window_seconds: 3600,
  });
  if (limit.error) return fail("rate_limited", 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_request");
  }
  const text = cleanText(body.text);
  if (!text) return fail("invalid_query");

  try {
    const res = await fetch(photonUrl(PHOTON_URL, text, parseBias(body.bias)), {
      headers: { "User-Agent": "Rendezview-place-search", Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return fail("search_unavailable", 502);
    return json({ results: parsePhoton(await res.json()) });
  } catch {
    return fail("search_unavailable", 502);
  }
});
