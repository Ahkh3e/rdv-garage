import { anonClient, corsHeaders, fail, json, serviceClient } from "../_shared/lib.ts";
import { rpcFailure, searchPlaces } from "./handler.ts";

const PHOTON_URL = Deno.env.get("PHOTON_URL") ?? "https://photon.komoot.io";
const PHOTON_KEY = Deno.env.get("PHOTON_KEY") || undefined;

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
  const denied = rpcFailure(limit.error);
  if (denied) return json(denied.body, denied.status);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_request");
  }
  const outcome = await searchPlaces(body, PHOTON_URL, fetch, undefined, PHOTON_KEY);
  return json(outcome.body, outcome.status);
});
