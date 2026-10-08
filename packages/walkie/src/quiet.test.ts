import { describe, expect, it } from "vitest";
import { EXPECTED_LIVEKIT_LOGS, installExpectedLogFilter, isExpectedLiveKitLog } from "./quiet";

describe("expected livekit logs", () => {
  it("matches the disconnect noise", () => {
    expect(isExpectedLiveKitLog("error reading from signal stream, WS closed unexpectedly with code 1001")).toBe(true);
    expect(isExpectedLiveKitLog("ping timeout triggered. last pong received at: x")).toBe(true);
  });
  it("leaves other errors visible", () => {
    expect(isExpectedLiveKitLog("could not publish track")).toBe(false);
    expect(isExpectedLiveKitLog("")).toBe(false);
    expect(isExpectedLiveKitLog("WS closed unexpectedly while connecting")).toBe(false);
  });
  it("patterns are usable by LogBox", () => {
    expect(EXPECTED_LIVEKIT_LOGS.every((p) => p instanceof RegExp)).toBe(true);
  });
});

describe("console filter", () => {
  it("drops expected lines, passes the rest, and installs once", () => {
    const seen: unknown[][] = [];
    const target = { error: (...a: unknown[]) => void seen.push(a) };
    installExpectedLogFilter(target);
    const first = target.error;
    installExpectedLogFilter(target);
    expect(target.error).toBe(first);
    target.error("error reading from signal stream, WS closed unexpectedly with code 1001");
    target.error("could not publish", 1);
    target.error(new Error("ping timeout triggered"));
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(["could not publish", 1]);
  });
  it("also drops expected lines logged as warnings", () => {
    const seen: unknown[][] = [];
    const target = { error: (...a: unknown[]) => void seen.push(a), warn: (...a: unknown[]) => void seen.push(a) };
    installExpectedLogFilter(target);
    const warn = target.warn;
    installExpectedLogFilter(target);
    expect(target.warn).toBe(warn);
    target.warn("ping timeout triggered. last pong received at: x", { room: "r" });
    target.warn("something else", 2);
    expect(seen).toEqual([["something else", 2]]);
  });
});
