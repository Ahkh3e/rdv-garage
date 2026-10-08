import { createHmac, timingSafeEqual } from "node:crypto";

export interface RelayClaims {
  sub: string;
  room: string;
  pub: boolean;
  exp: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENTITY = /^[0-9a-f]{32}$/;
const MAX_LIFETIME_SECONDS = 3600;
const LEEWAY_SECONDS = 10;

export function safeEqual(a: string, b: string): boolean {
  const x = createHmac("sha256", "cmp").update(a).digest();
  const y = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(x, y);
}

export function verifyToken(token: string, secret: string, nowSeconds: number): RelayClaims | null {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    if (header?.alg !== "HS256") return null;
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!c || typeof c !== "object" || c.iss !== "rendezview") return null;
    if (typeof c.exp !== "number" || c.exp <= nowSeconds || c.exp > nowSeconds + MAX_LIFETIME_SECONDS) return null;
    if (c.nbf !== undefined && (typeof c.nbf !== "number" || c.nbf > nowSeconds + LEEWAY_SECONDS)) return null;
    if (typeof c.sub !== "string" || !IDENTITY.test(c.sub)) return null;
    if (typeof c.room !== "string" || !UUID.test(c.room)) return null;
    if (typeof c.pub !== "boolean") return null;
    return { sub: c.sub, room: c.room, pub: c.pub, exp: c.exp };
  } catch {
    return null;
  }
}
