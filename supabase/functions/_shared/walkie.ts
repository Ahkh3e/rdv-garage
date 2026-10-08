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

// The audio service's participant id: stable inside one room, unlinkable across rooms, and not reversible to the account.
export async function participantIdentity(secret: string, userId: string, roomId: string): Promise<string> {
  const digest = await hmac(secret, `walkie:v1:${roomId}:${userId}`);
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const TOKEN_TTL_SECONDS = 300;

export interface VideoGrant {
  room: string;
  roomJoin?: boolean;
  roomAdmin?: boolean;
  canSubscribe?: boolean;
  canPublish?: boolean;
  canPublishData?: boolean;
  canPublishSources?: string[];
  canUpdateOwnMetadata?: boolean;
}

export async function signJwt(secret: string, claims: Record<string, unknown>): Promise<string> {
  const head = b64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = await hmac(secret, `${head}.${body}`);
  return `${head}.${body}.${b64url(sig)}`;
}

export function listenerGrant(room: string, canPublish: boolean): VideoGrant {
  return {
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish,
    canPublishData: false,
    canPublishSources: canPublish ? ["microphone"] : [],
    canUpdateOwnMetadata: false,
  };
}

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export function mintToken(cfg: LiveKitConfig, identity: string, grant: VideoGrant, nowSeconds: number, ttl = TOKEN_TTL_SECONDS): Promise<string> {
  return signJwt(cfg.apiSecret, {
    iss: cfg.apiKey,
    sub: identity,
    name: "",
    nbf: nowSeconds - 5,
    exp: nowSeconds + ttl,
    video: grant,
  });
}

export interface VoiceAdmin {
  removeParticipant(room: string, identity: string): Promise<void>;
  deleteRoom(room: string): Promise<void>;
}

const httpBase = (url: string) => url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");

// LiveKit's server API is Twirp over HTTP. A room or participant that is already gone answers not_found, which counts as done.
export function liveKitAdmin(cfg: LiveKitConfig, doFetch: typeof fetch = fetch): VoiceAdmin {
  const call = async (method: string, room: string, body: Record<string, string>) => {
    const jwt = await mintToken(cfg, "walkie-server", { room, roomAdmin: true }, Math.floor(Date.now() / 1000), 60);
    const res = await doFetch(`${httpBase(cfg.url)}/twirp/livekit.RoomService/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, "User-Agent": "Rendezview-walkie-server" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok || res.status === 404) return;
    throw new Error(`livekit ${method} ${res.status}`);
  };
  return {
    removeParticipant: (room, identity) => call("RemoveParticipant", room, { room, identity }),
    deleteRoom: (room) => call("DeleteRoom", room, { room }),
  };
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
