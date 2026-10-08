import type { Unsubscribe } from "./events";

export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

export interface VoiceJoin {
  url: string;
  token: string;
}

// Live audio for a room (decision 0027). One implementation sits behind it so the service can be replaced or self-hosted.
export interface Voice {
  // Joins the room named by the token, listening. The microphone stays closed until setMicOpen(true).
  connect(join: VoiceJoin): Promise<void>;
  disconnect(): Promise<void>;
  // Opens or closes the microphone. Opening publishes; closing stops publishing.
  setMicOpen(open: boolean): Promise<void>;
  // Asks for the microphone permission; resolves true when granted.
  requestMicPermission(): Promise<boolean>;
  // Silences what the person hears without leaving the channel.
  setSoundMuted(muted: boolean): void;
  // The audio service's id for this device, or null before connecting.
  identity(): string | null;
  onStatus(fn: (status: VoiceStatus) => void): Unsubscribe;
  // Participant ids of whoever the service currently hears speaking.
  onSpeakers(fn: (identities: string[]) => void): Unsubscribe;
  // Audio level 0 to 1 per participant id, while connected.
  onLevels(fn: (levels: Record<string, number>) => void): Unsubscribe;
}
