import { describe, expect, it } from "vitest";
import { createRelayClient, relayUrl, type SocketLike } from "./relayClient";
import type { VoiceStatus } from "@rdv/core/voice";

class FakeSocket implements SocketLike {
  binaryType = "";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(d: any) { this.sent.push(d); }
  close() { this.closed = true; this.readyState = 3; }
  up() { this.readyState = 1; this.onopen?.(); }
  say(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  hello() { this.say({ t: "hello", you: 0, peers: [] }); }
  drop() { this.onclose?.(); }
}

function setup(over: Record<string, unknown> = {}) {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number; id: number; live: boolean }[] = [];
  let clock = 0;
  const client = createRelayClient({
    open: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    timers: {
      set: (fn, ms) => { const t = { fn, ms, id: timers.length, live: true }; timers.push(t); return t; },
      clear: (h: any) => { h.live = false; },
    },
    retryDelaysMs: [10, 20],
    pingEveryMs: 100,
    deadAfterMs: 250,
    now: () => clock,
    ...over,
  });
  const statuses: VoiceStatus[] = [];
  client.onStatus((s) => statuses.push(s));
  const fire = (ms: number) => { const t = timers.filter((x) => x.live && x.ms === ms).at(-1)!; t.live = false; t.fn(); };
  const joined = async () => { const p = client.connect("wss://relay.test", "tok"); const s = sockets.at(-1)!; s.up(); s.hello(); await p; return s; };
  return { client, sockets, timers, statuses, fire, joined, tick: (ms: number) => (clock += ms) };
}

describe("relay client", () => {
  it("builds the socket url from the token", () => {
    expect(relayUrl("wss://r.test/", "a b")).toBe("wss://r.test/ws?token=a%20b");
    expect(relayUrl("https://r.test", "t")).toBe("wss://r.test/ws?token=t");
  });

  it("resolves connect on hello and rejects when the first attempt fails", async () => {
    const a = setup();
    const s = await a.joined();
    expect(s.url).toBe("wss://relay.test/ws?token=tok");
    expect(a.client.connected()).toBe(true);
    const b = setup();
    const p = b.client.connect("wss://relay.test", "tok");
    b.sockets[0]!.drop();
    await expect(p).rejects.toThrow();
    expect(b.statuses).toEqual([]);
  });

  it("retries a dropped connection with the same token, then reports connected", async () => {
    const t = setup();
    const first = await t.joined();
    first.drop();
    expect(t.statuses).toEqual(["reconnecting"]);
    t.fire(10);
    const second = t.sockets[1]!;
    expect(second.url).toBe(first.url);
    second.up();
    second.hello();
    expect(t.statuses).toEqual(["reconnecting", "connected"]);
  });

  it("gives up after the retries and reports disconnected so the caller can fetch a new token", async () => {
    const t = setup();
    (await t.joined()).drop();
    t.fire(10);
    t.sockets[1]!.drop();
    expect(t.statuses).toEqual(["reconnecting", "reconnecting"]);
    t.fire(20);
    t.sockets[2]!.drop();
    expect(t.statuses.at(-1)).toBe("disconnected");
    expect(t.sockets).toHaveLength(3);
  });

  it("does not retry after being kicked and ignores events from old sockets", async () => {
    const t = setup();
    const s = await t.joined();
    s.say({ t: "kicked" });
    expect(t.statuses).toEqual(["disconnected"]);
    expect(s.closed).toBe(true);
    s.drop();
    expect(t.sockets).toHaveLength(1);
  });

  it("does not retry after an explicit disconnect", async () => {
    const t = setup();
    const s = await t.joined();
    t.client.disconnect();
    s.drop();
    expect(t.statuses).toEqual([]);
    expect(t.timers.every((x) => !x.live)).toBe(true);
  });

  it("treats a silent connection as dead and sends keep-alive pings", async () => {
    const t = setup();
    const s = await t.joined();
    t.tick(100);
    t.fire(100);
    expect(s.sent).toEqual(['{"t":"ping"}']);
    s.say({ t: "pong" });
    t.tick(300);
    t.fire(100);
    expect(t.statuses).toEqual(["reconnecting"]);
    expect(s.closed).toBe(true);
  });

  it("delivers messages and frames and sends talk and audio only while open", async () => {
    const t = setup();
    const msgs: unknown[] = [];
    const frames: unknown[] = [];
    t.client.onMessage((m) => msgs.push(m));
    t.client.onFrame((f) => frames.push(f));
    t.client.setTalk(true);
    const s = await t.joined();
    s.say({ t: "talk", i: 2, on: true });
    s.onmessage?.({ data: Uint8Array.of(2, 1, 0, 7, 9, 9).buffer });
    s.onmessage?.({ data: "garbage" });
    expect(msgs.map((m: any) => m.t)).toEqual(["hello", "talk"]);
    expect(frames).toEqual([{ sender: 2, codec: 1, seq: 7, payload: Uint8Array.of(9, 9) }]);
    t.client.setTalk(true);
    t.client.sendFrame(Uint8Array.of(1, 0, 1, 5));
    expect(s.sent).toEqual(['{"t":"talk","on":true}', Uint8Array.of(1, 0, 1, 5)]);
  });
});
