import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function fail(code: string, status = 400): Response {
  return json({ error: code }, status);
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function clientIp(req: Request): string {
  // The platform sets cf-connecting-ip and clients cannot forge it. A client controls the front of x-forwarded-for,
  // so when only that header exists use its last entry, which the nearest proxy added.
  const direct = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
  if (direct?.trim()) return direct.trim();
  const forwarded = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded.at(-1) ?? "unknown";
}

// Maps a Postgres P0001 error raised by our functions to its stable code.
export function pgCode(error: { message?: string } | null): string {
  const message = error?.message ?? "";
  return /^[a-z_]+$/.test(message) ? message : "unknown_error";
}

export function environment(): string {
  return Deno.env.get("ENVIRONMENT") ?? "production";
}

// Test mode confirms accounts on the server and sends no email (decision 0014).
// It is honored only in development and test projects; in production the setting is ignored and logged.
export function testModeEnabled(): boolean {
  const requested = Deno.env.get("AUTO_CONFIRM_EMAIL") === "true";
  if (!requested) return false;
  const env = environment();
  if (env === "development" || env === "test") return true;
  console.error("AUTO_CONFIRM_EMAIL is set in a production environment and is being ignored");
  return false;
}

export function sessionIdFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.session_id ?? null;
  } catch {
    return null;
  }
}
