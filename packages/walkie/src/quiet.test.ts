import { describe, expect, it } from "vitest";
import { EXPECTED_LIVEKIT_LOGS, isExpectedLiveKitLog } from "./quiet";

describe("expected livekit logs", () => {
  it("matches the disconnect noise", () => {
    expect(isExpectedLiveKitLog("error reading from signal stream, WS closed unexpectedly with code 1001")).toBe(true);
    expect(isExpectedLiveKitLog("ping timeout triggered. last pong received at: x")).toBe(true);
  });
  it("leaves other errors visible", () => {
    expect(isExpectedLiveKitLog("could not publish track")).toBe(false);
    expect(isExpectedLiveKitLog("")).toBe(false);
  });
  it("patterns are usable by LogBox", () => {
    expect(EXPECTED_LIVEKIT_LOGS.every((p) => p instanceof RegExp)).toBe(true);
  });
});
