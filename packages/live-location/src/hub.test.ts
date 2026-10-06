import { describe, expect, it, vi } from "vitest";
import { ChannelHub } from "./hub";

function fakeBackend() {
  let onStatus: ((s: "SUBSCRIBED" | "ERROR" | "CLOSED" | "TIMED_OUT") => void) | undefined;
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn((cb) => void (onStatus = cb)),
    send: vi.fn(async () => undefined),
    track: vi.fn(async () => undefined),
    untrack: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
  };
  return { backend: { channel: () => channel } as any, channel, status: (s: any) => onStatus!(s) };
}

describe("ChannelHub", () => {
  it("announces presence that was requested before the channel was ready, and again after a reconnect", () => {
    const { backend, channel, status } = fakeBackend();
    const hub = new ChannelHub(backend);
    hub.acquire("a");
    hub.track("a", { user_id: "me" });
    expect(channel.track).not.toHaveBeenCalled();
    status("SUBSCRIBED");
    expect(channel.track).toHaveBeenCalledWith({ user_id: "me" });
    status("CLOSED");
    status("SUBSCRIBED");
    expect(channel.track).toHaveBeenCalledTimes(2);
    hub.untrack("a");
    status("SUBSCRIBED");
    expect(channel.track).toHaveBeenCalledTimes(2);
  });

  it("drops sends until ready, shares one channel, and closes it when the last holder lets go", () => {
    const { backend, channel, status } = fakeBackend();
    const hub = new ChannelHub(backend);
    const r1 = hub.acquire("a");
    const r2 = hub.acquire("a");
    hub.send("a", "pos", { x: 1 });
    expect(channel.send).not.toHaveBeenCalled();
    status("SUBSCRIBED");
    hub.send("a", "pos", { x: 1 });
    expect(channel.send).toHaveBeenCalledTimes(1);
    r1();
    expect(channel.unsubscribe).not.toHaveBeenCalled();
    r2();
    r2();
    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
