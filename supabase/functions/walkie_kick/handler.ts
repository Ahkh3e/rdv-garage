import { participantIdentity, timingSafeEqual, type VoiceAdmin } from "../_shared/walkie.ts";

export interface Outcome {
  status: number;
  body: unknown;
}

export interface KickDeps {
  sharedSecret: string | null;
  identitySecret: string | null;
  admin: VoiceAdmin | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Called only by the database. user_id absent means everyone in the room (closed or deleted). Repeats are harmless.
export async function kick(presentedSecret: string | null, body: unknown, deps: KickDeps): Promise<Outcome> {
  if (!deps.sharedSecret || !presentedSecret || !timingSafeEqual(presentedSecret, deps.sharedSecret)) {
    return { status: 401, body: { error: "unauthenticated" } };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "invalid_request" } };
  const input = body as Record<string, unknown>;
  const room = input.room_id;
  const user = input.user_id ?? null;
  if (typeof room !== "string" || !UUID.test(room) || (user !== null && (typeof user !== "string" || !UUID.test(user)))) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  if (!deps.admin || !deps.identitySecret) return { status: 503, body: { error: "walkie_unavailable" } };
  const roomId = room.toLowerCase();
  try {
    if (user === null) await deps.admin.deleteRoom(roomId);
    else await deps.admin.removeParticipant(roomId, await participantIdentity(deps.identitySecret, (user as string).toLowerCase(), roomId));
  } catch {
    return { status: 502, body: { error: "walkie_unavailable" } };
  }
  return { status: 200, body: { ok: true } };
}
