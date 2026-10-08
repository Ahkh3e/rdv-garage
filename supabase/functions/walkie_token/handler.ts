import { type LiveKitConfig, listenerGrant, mintToken, participantIdentity, TOKEN_TTL_SECONDS } from "../_shared/walkie.ts";

export interface Outcome {
  status: number;
  body: unknown;
}

export interface Access {
  state: string;
  can_publish?: boolean;
  voice_off_crews?: string[];
}

export interface TokenDeps {
  livekit: LiveKitConfig | null;
  identitySecret: string | null;
  access(roomId: string, userId: string): Promise<Access | null>;
  now(): number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSALS: Record<string, number> = { room_not_found: 404, not_room_member: 403, room_closed: 409, suspended: 403 };

export function rpcFailure(error: { message?: string } | null): Outcome | null {
  if (!error) return null;
  return error.message === "rate_limited"
    ? { status: 429, body: { error: "rate_limited" } }
    : { status: 502, body: { error: "walkie_unavailable" } };
}

export async function issueToken(body: unknown, userId: string, deps: TokenDeps): Promise<Outcome> {
  const unavailable = { status: 503, body: { error: "walkie_unavailable" } };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "invalid_request" } };
  const roomId = (body as Record<string, unknown>).room_id;
  if (typeof roomId !== "string" || !UUID.test(roomId)) return { status: 400, body: { error: "room_not_found" } };
  if (!deps.livekit || !deps.identitySecret) return unavailable;
  const room = roomId.toLowerCase();
  const access = await deps.access(room, userId);
  if (!access) return unavailable;
  if (access.state !== "ok") return { status: REFUSALS[access.state] ?? 403, body: { error: access.state } };
  const canPublish = access.can_publish === true;
  const identity = await participantIdentity(deps.identitySecret, userId, room);
  const token = await mintToken(deps.livekit, identity, listenerGrant(room, canPublish), deps.now());
  return {
    status: 200,
    body: { token, url: deps.livekit.url, can_publish: canPublish, expires_in: TOKEN_TTL_SECONDS, voice_off_crews: access.voice_off_crews ?? [] },
  };
}
