import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(): Record<string, string> {
  const out = execSync("supabase status -o env", { cwd: root, encoding: "utf8" });
  const env: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m?.[1]) env[m[1]] = m[2] ?? "";
  }
  return env;
}

const env = loadEnv();
export const API_URL = env.API_URL!;
export const ANON_KEY = env.ANON_KEY!;
export const SERVICE_KEY = env.SERVICE_ROLE_KEY!;
export const DB_URL = env.DB_URL!;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin: SupabaseClient = createClient(API_URL, SERVICE_KEY, opts);
export const anon: SupabaseClient = createClient(API_URL, ANON_KEY, opts);

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const res = await client.query(text, params);
    return res.rows as T[];
  } finally {
    await client.end();
  }
}

export function uniq(prefix = "t"): string {
  return `${prefix}${randomBytes(4).toString("hex")}`;
}

export interface TestUser {
  id: string;
  handle: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

export async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(API_URL, ANON_KEY, opts);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed: ${error.message}`);
  return client;
}

// Creates a confirmed user and profile directly (operator path, no invite).
export async function createUser(handle = uniq("u"), invitedBy: string | null = null): Promise<TestUser> {
  const email = `${handle}@example.test`;
  const password = "correct-horse-battery";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const { error: profileError } = await admin.schema("accounts").rpc("create_profile", {
    p_id: data.user.id,
    p_handle: handle,
    p_invited_by: invitedBy,
    p_invite_id: null,
    p_terms_version: "v1",
    p_synthetic: true,
  });
  if (profileError) throw new Error(`create_profile failed: ${profileError.message}`);
  const client = await signIn(email, password);
  return { id: data.user.id, handle, email, password, client };
}

export async function call<T = unknown>(client: SupabaseClient, schema: string, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await client.schema(schema).rpc(fn, args);
  return { data: data as T, error: error?.message ?? null };
}

export async function callOk<T = unknown>(client: SupabaseClient, schema: string, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await call<T>(client, schema, fn, args);
  if (error) throw new Error(`${schema}.${fn} failed: ${error}`);
  return data;
}

export async function register(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API_URL}/functions/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export async function invokeAs(client: SupabaseClient, name: string, body: Record<string, unknown> = {}) {
  const { data: session } = await client.auth.getSession();
  const res = await fetch(`${API_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.session?.access_token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export async function createCrew(owner: TestUser, name = `Crew ${uniq("c")}`) {
  const rows = await callOk<{ id: string; link_code: string }[]>(owner.client, "crews", "create_crew", { p_name: name });
  return rows[0]!;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
