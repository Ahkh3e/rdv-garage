const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

// The participant id on the voice relay: stable inside one room, unlinkable across rooms, and not reversible to the account.
export async function participantIdentity(secret: string, userId: string, roomId: string): Promise<string> {
  const digest = await hmac(secret, `walkie:v1:${roomId}:${userId}`);
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const TOKEN_TTL_SECONDS = 300;

export async function signJwt(secret: string, claims: Record<string, unknown>): Promise<string> {
  const head = b64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = await hmac(secret, `${head}.${body}`);
  return `${head}.${body}.${b64url(sig)}`;
}

export interface RelayConfig {
  url: string;
  secret: string;
  adminSecret: string;
}

// The relay verifies this HS256 token itself (relay/src/jwt.ts): the room, who may talk, and an opaque participant id.
export function mintToken(cfg: Pick<RelayConfig, "secret">, identity: string, room: string, canPublish: boolean, nowSeconds: number, ttl = TOKEN_TTL_SECONDS): Promise<string> {
  return signJwt(cfg.secret, { iss: "rendezview", sub: identity, room, pub: canPublish, nbf: nowSeconds - 5, exp: nowSeconds + ttl });
}

export interface VoiceAdmin {
  removeParticipant(room: string, identity: string): Promise<void>;
  deleteRoom(room: string): Promise<void>;
}

const httpBase = (url: string) => url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");

// The relay closes the matching sockets; a room or participant that is not connected closes nothing, which counts as done.
export function relayAdmin(cfg: RelayConfig, doFetch: typeof fetch = fetch): VoiceAdmin {
  const call = async (body: Record<string, string>) => {
    const res = await doFetch(`${httpBase(cfg.url)}/admin/kick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-relay-secret": cfg.adminSecret, "User-Agent": "Rendezview-walkie-server" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`relay kick ${res.status}`);
  };
  return {
    removeParticipant: (room, identity) => call({ room, identity }),
    deleteRoom: (room) => call({ room }),
  };
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
