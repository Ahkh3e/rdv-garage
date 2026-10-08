import type { WalkieState } from "./controller";

export const MIC_EXPLANATION = "Rendezview uses your microphone only while you hold Talk. Everyone in the room hears you, and nothing is recorded by Rendezview.";

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "this room's crew";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function voiceOffLine(names: string[]): string {
  return `Voice is off for you in ${joinNames(names)}`;
}

export interface StatusLine {
  tone: "info" | "warn";
  text: string;
}

// The one line under the speaker strip: why the person cannot talk, or what is happening with the connection.
export function statusLine(s: Pick<WalkieState, "phase" | "canPublish" | "voiceOffCrews" | "mic" | "limitReached" | "error">): StatusLine | null {
  switch (s.phase) {
    case "joining":
      return { tone: "info", text: "Joining voice..." };
    case "reconnecting":
      return { tone: "info", text: "Reconnecting voice..." };
    case "unavailable":
      if (s.error === "rate_limited") return { tone: "warn", text: "Busy, try again shortly." };
      return { tone: "warn", text: "Voice isn't available right now. Trying again..." };
    case "removed":
      return { tone: "warn", text: s.error === "room_closed" ? "This room is closed. Voice has ended." : "You're no longer in this room's voice channel." };
    case "left":
      return { tone: "info", text: "You left the voice channel." };
    case "listening":
      if (!s.canPublish) return { tone: "warn", text: voiceOffLine(s.voiceOffCrews) };
      if (s.mic === "denied") return { tone: "warn", text: "Microphone is off. Turn it on in Settings to talk." };
      if (s.limitReached) return { tone: "info", text: "Microphone closed after 60 seconds. Press again to keep talking." };
      return null;
    default:
      return null;
  }
}

export function canTalk(s: Pick<WalkieState, "phase" | "canPublish">): boolean {
  return s.phase === "listening" && s.canPublish;
}

export function level(value: number | undefined): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? (value as number) : 0));
}
