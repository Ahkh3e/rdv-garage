import { describe, expect, it } from "vitest";
import { canTalk, joinNames, level, statusLine, voiceOffLine } from "./lines";

const base = { phase: "listening" as const, canPublish: true, voiceOffCrews: [] as string[], mic: "unknown" as const, limitReached: false, error: null };

describe("status line", () => {
  it("says voice is off in the crew's name, joining several", () => {
    expect(statusLine({ ...base, canPublish: false, voiceOffCrews: ["Night Run"] })).toEqual({ tone: "warn", text: "Voice is off for you in Night Run" });
    expect(voiceOffLine(["A", "B", "C"])).toBe("Voice is off for you in A, B and C");
    expect(joinNames([])).toBe("this room's crew");
  });

  it("explains a refused microphone, the 60 second close, and connection states", () => {
    expect(statusLine({ ...base, mic: "denied" })!.text).toMatch(/Settings/);
    expect(statusLine({ ...base, limitReached: true })!.text).toMatch(/60 seconds/);
    expect(statusLine({ ...base, phase: "reconnecting" })!.text).toMatch(/Reconnecting/);
    expect(statusLine({ ...base, phase: "removed", error: "room_closed" })!.text).toMatch(/closed/);
    expect(statusLine({ ...base, phase: "removed", error: "not_room_member" })!.text).toMatch(/no longer/);
    expect(statusLine(base)).toBeNull();
    expect(statusLine({ ...base, phase: "idle" })).toBeNull();
  });

  it("allows Talk only while listening with the grant", () => {
    expect(canTalk(base)).toBe(true);
    expect(canTalk({ ...base, canPublish: false })).toBe(false);
    expect(canTalk({ ...base, phase: "reconnecting" })).toBe(false);
  });

  it("clamps audio levels to 0..1", () => {
    expect([level(undefined), level(-1), level(0.4), level(7), level(NaN)]).toEqual([0, 0, 0.4, 1, 0]);
  });
});
