import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRelay, type RelayOptions } from "./relay.js";
import { verifyToken } from "./jwt.js";

const SECRET = "s".repeat(40);
const ADMIN = "a".repeat(40);
const ROOM = "11111111-1111-4111-8111-111111111111";
const ROOM2 = "22222222-2222-4222-8222-222222222222";
const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);
const ID_C = "c".repeat(32);

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(claims: Record<string, unknown>, secret = SECRET, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }) {
  const body = `${b64(header)}.${b64(claims)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
const nowS = () => Math.floor(Date.now() / 1000);
const token = (over: Record<string, unknown> = {}) =>
  sign({ iss: "rendezview", sub: ID_A, room: ROOM, pub: true, nbf: nowS() - 5, exp: nowS() + 300, ...over });

let relay: ReturnType<typeof createRelay>;
let base = "";
const sockets: WebSocket[] = [];

async function start(opts: Partial<RelayOptions> = {}) {
  relay = createRelay({ secret: SECRET, adminSecret: ADMIN, ...opts });
  await new Promise<void>((r) => relay.server.listen(0, "127.0.0.1", r));
  base = `127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
}

interface Client {
  ws: WebSocket;
  texts: any[];
  frames: Buffer[];
  closed: Promise<number>;
  next(pred: (m: any) => boolean): Promise<any>;
}
async function connect(tok: string): Promise<Client> {
  const ws = new WebSocket(`ws://${base}/ws?token=${tok}`);
  sockets.push(ws);
  const c: Client = { ws, texts: [], frames: [], closed: new Promise((r) => ws.on("close", (code) => r(code))), next: null as never };
  const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  ws.on("message", (data, binary) => {
    if (binary) return void c.frames.push(Buffer.from(data as Buffer));
    const m = JSON.parse(data.toString());
    c.texts.push(m);
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m));
  });
  c.next = (pred) => {
    const seen = c.texts.find(pred);
    return seen ? Promise.resolve(seen) : new Promise((resolve) => waiters.push({ pred, resolve }));
  };
  await c.next((m) => m.t === "hello");
  return c;
}
const failStatus = (tok: string) =>
  new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://${base}/ws?token=${tok}`);
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("error", () => undefined);
    ws.on("open", () => resolve(101));
    sockets.push(ws);
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = (seq: number, n = 20) => Buffer.concat([Buffer.from([1, seq >> 8, seq & 255]), Buffer.alloc(n, 7)]);
const talk = (c: Client, on: boolean) => c.ws.send(JSON.stringify({ t: "talk", on }));
const admin = (path: string, body?: unknown, secret = ADMIN, method = body === undefined ? "GET" : "POST") =>
  fetch(`http://${base}${path}`, { method, headers: { "x-relay-secret": secret, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await relay?.close();
});

describe("tokens", () => {
  beforeEach(() => start());

  it("accepts a valid token and says hello with the index and existing peers", async () => {
    const a = await connect(token());
    expect(a.texts[0]).toEqual({ t: "hello", you: 0, peers: [] });
    const b = await connect(token({ sub: ID_B }));
    expect(b.texts[0]).toEqual({ t: "hello", you: 1, peers: [{ i: 0, id: ID_A }] });
    expect(await a.next((m) => m.t === "join")).toEqual({ t: "join", i: 1, id: ID_B });
  });

  it("refuses expired, forged, malformed and wrong-shape tokens", async () => {
    expect(await failStatus(token({ exp: nowS() - 1 }))).toBe(401);
    expect(await failStatus(token({ nbf: nowS() + 600 }))).toBe(401);
    expect(await failStatus(sign({ iss: "rendezview", sub: ID_A, room: ROOM, pub: true, exp: nowS() + 300 }, "x".repeat(40)))).toBe(401);
    expect(await failStatus(sign({ iss: "rendezview", sub: ID_A, room: ROOM, pub: true, exp: nowS() + 300 }, SECRET, { alg: "none" }))).toBe(401);
    expect(await failStatus(token({ iss: "other" }))).toBe(401);
    expect(await failStatus(token({ sub: "not-hex" }))).toBe(401);
    expect(await failStatus(token({ room: "nope" }))).toBe(401);
    expect(await failStatus(token({ pub: "yes" }))).toBe(401);
    expect(await failStatus(token({ exp: nowS() + 100000 }))).toBe(401);
    expect(await failStatus("garbage")).toBe(401);
    expect(await failStatus("")).toBe(401);
    expect(verifyToken(token(), "", nowS())).toBeNull();
  });

  it("replaces an older connection of the same identity", async () => {
    const first = await connect(token());
    const peer = await connect(token({ sub: ID_B }));
    const second = await connect(token());
    expect(await first.closed).toBe(4000);
    expect(await peer.next((m) => m.t === "leave")).toEqual({ t: "leave", i: 0 });
    expect(second.texts[0].peers).toEqual([{ i: 1, id: ID_B }]);
    expect(relay.stats().connections).toBe(2);
  });
});

describe("relaying", () => {
  beforeEach(() => start());

  it("relays frames to others with the sender index, not back to the sender, and attributes talk", async () => {
    const a = await connect(token());
    const b = await connect(token({ sub: ID_B }));
    const c = await connect(token({ sub: ID_C, room: ROOM2 }));
    talk(a, true);
    expect(await b.next((m) => m.t === "talk")).toEqual({ t: "talk", i: 0, on: true });
    a.ws.send(frame(0x0102), { binary: true });
    await sleep(80);
    expect(b.frames).toHaveLength(1);
    expect([...b.frames[0]!.subarray(0, 4)]).toEqual([0, 1, 1, 2]);
    expect(b.frames[0]!.length).toBe(24);
    expect(a.frames).toHaveLength(0);
    expect(c.frames).toHaveLength(0);
    talk(a, false);
    expect(await b.next((m) => m.t === "talk" && !m.on)).toEqual({ t: "talk", i: 0, on: false });
    const stats = await (await admin("/admin/stats")).json();
    expect(stats).toEqual({ rooms: 2, connections: 3, framesRelayed: 1, bytesRelayed: 24 });
  });

  it("forwards several talkers at once and announces leaves", async () => {
    const a = await connect(token());
    const b = await connect(token({ sub: ID_B }));
    const c = await connect(token({ sub: ID_C }));
    talk(a, true);
    talk(b, true);
    await c.next((m) => m.t === "talk" && m.i === 1);
    a.ws.send(frame(1), { binary: true });
    b.ws.send(frame(1), { binary: true });
    await sleep(80);
    expect(c.frames.map((f) => f[0]).sort()).toEqual([0, 1]);
    b.ws.close();
    expect(await c.next((m) => m.t === "leave")).toEqual({ t: "leave", i: 1 });
  });

  it("ignores talk and frames from a listener-only token, and frames without a talk turn", async () => {
    const a = await connect(token());
    const l = await connect(token({ sub: ID_B, pub: false }));
    talk(l, true);
    l.ws.send(frame(1), { binary: true });
    a.ws.send(frame(1), { binary: true });
    await sleep(80);
    expect(a.texts.some((m) => m.t === "talk")).toBe(false);
    expect(a.frames).toHaveLength(0);
    expect(l.frames).toHaveLength(0);
  });

  it("drops oversized frames and frames over the rate limit", async () => {
    await relay.close();
    await start({ maxFrameBytes: 100, maxFramesPerSecond: 5 });
    const a = await connect(token());
    const b = await connect(token({ sub: ID_B }));
    talk(a, true);
    await b.next((m) => m.t === "talk");
    a.ws.send(frame(1, 200), { binary: true });
    for (let i = 0; i < 20; i++) a.ws.send(frame(i, 10), { binary: true });
    await sleep(150);
    expect(b.frames).toHaveLength(5);
    expect(b.frames.every((f) => f.length === 14)).toBe(true);
  });

  it("cuts a talk turn off after the limit and ignores frames until talk is sent again", async () => {
    await relay.close();
    await start({ talkLimitMs: 120 });
    const a = await connect(token());
    const b = await connect(token({ sub: ID_B }));
    talk(a, true);
    await b.next((m) => m.t === "talk" && m.on);
    const off = await a.next((m) => m.t === "talk" && !m.on);
    expect(off).toEqual({ t: "talk", i: 0, on: false });
    a.ws.send(frame(1), { binary: true });
    await sleep(60);
    expect(b.frames).toHaveLength(0);
    talk(a, true);
    await sleep(30);
    a.ws.send(frame(2), { binary: true });
    await sleep(60);
    expect(b.frames).toHaveLength(1);
  });

  it("caps a room and answers pings", async () => {
    await relay.close();
    await start({ maxPerRoom: 2 });
    const a = await connect(token());
    await connect(token({ sub: ID_B }));
    expect(await failStatus(token({ sub: ID_C }))).toBe(503);
    a.ws.send('{"t":"ping"}');
    expect(await a.next((m) => m.t === "pong")).toEqual({ t: "pong" });
    expect(await failStatus(token())).toBe(101);
  });

  it("closes sockets that stop answering pings", async () => {
    await relay.close();
    await start({ pingIntervalMs: 40 });
    const a = await connect(token());
    a.ws.pong = () => undefined;
    (a.ws as any)._receiver.removeAllListeners("ping");
    await a.closed;
    expect(relay.stats().connections).toBe(0);
  });
});

describe("admin", () => {
  beforeEach(() => start());

  it("guards the endpoints with the admin secret", async () => {
    expect((await admin("/admin/stats", undefined, "wrong")).status).toBe(401);
    expect((await admin("/admin/kick", { room: ROOM }, "wrong")).status).toBe(401);
    expect((await fetch(`http://${base}/admin/stats`)).status).toBe(401);
    expect((await fetch(`http://${base}/healthz`)).status).toBe(200);
    expect((await admin("/admin/kick", { room: "x" })).status).toBe(400);
    expect((await admin("/admin/kick", { room: ROOM, identity: 5 })).status).toBe(400);
  });

  it("kicks one identity after sending kicked, then the whole room", async () => {
    const a = await connect(token());
    const b = await connect(token({ sub: ID_B }));
    const other = await connect(token({ sub: ID_C, room: ROOM2 }));
    expect(await (await admin("/admin/kick", { room: ROOM, identity: ID_A })).json()).toEqual({ closed: 1 });
    expect(await a.next((m) => m.t === "kicked")).toEqual({ t: "kicked" });
    expect(await a.closed).toBe(4001);
    expect(await b.next((m) => m.t === "leave")).toEqual({ t: "leave", i: 0 });
    expect(await (await admin("/admin/kick", { room: ROOM })).json()).toEqual({ closed: 1 });
    await b.closed;
    expect(await (await admin("/admin/kick", { room: ROOM })).json()).toEqual({ closed: 0 });
    expect(relay.stats()).toMatchObject({ rooms: 1, connections: 1 });
    expect(other.ws.readyState).toBe(WebSocket.OPEN);
  });
});
