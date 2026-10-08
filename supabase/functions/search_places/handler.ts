import { cleanText, parseBias, parsePhoton, photonUrl } from "./photon.ts";

export const MAX_RESPONSE_BYTES = 256 * 1024;

export interface Outcome {
  status: number;
  body: unknown;
}

export function rpcFailure(error: { message?: string } | null): Outcome | null {
  if (!error) return null;
  return error.message === "rate_limited"
    ? { status: 429, body: { error: "rate_limited" } }
    : { status: 502, body: { error: "search_unavailable" } };
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function searchPlaces(
  body: unknown,
  photonBase: string,
  doFetch: typeof fetch = fetch,
  maxBytes = MAX_RESPONSE_BYTES,
  photonKey?: string,
): Promise<Outcome> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "invalid_request" } };
  const input = body as Record<string, unknown>;
  const text = cleanText(input.text);
  if (!text) return { status: 400, body: { error: "invalid_query" } };
  const unavailable = { status: 502, body: { error: "search_unavailable" } };
  try {
    const res = await doFetch(photonUrl(photonBase, text, parseBias(input.bias)), {
      headers: { "User-Agent": "Rendezview-place-search", Accept: "application/json", ...(photonKey ? { "X-Photon-Key": photonKey } : {}) },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return unavailable;
    const raw = await readCapped(res, maxBytes);
    if (raw === null) return unavailable;
    return { status: 200, body: { results: parsePhoton(JSON.parse(raw)) } };
  } catch {
    return unavailable;
  }
}
