import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { safeEqual, verifyToken } from "./jwt.js";

export interface RelayOptions {
  secret: string;
  adminSecret: string;
  maxFrameBytes?: number;
  maxFramesPerSecond?: number;
  talkLimitMs?: number;
  maxPerRoom?: number;
  pingIntervalMs?: number;
  maxBufferedBytes?: number;
  now?: () => number;
}

export interface RelayStats {
  rooms: number;
  connections: number;
  framesRelayed: number;
  bytesRelayed: number;
}

interface Peer {
  ws: WebSocket;
  room: string;
  identity: string;
  index: number;
  pub: boolean;
  talking: boolean;
  turn: ReturnType<typeof setTimeout> | null;
  windowStart: number;
  windowFrames: number;
  alive: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENTITY = /^[0-9a-f]{32}$/;
const CLOSE_REPLACED = 4000;
const CLOSE_KICKED = 4001;

const reject = (socket: Duplex, status: number, text: string) => {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};

export function createRelay(options: RelayOptions) {
  const maxFrame = options.maxFrameBytes ?? 1200;
  const maxFps = options.maxFramesPerSecond ?? 80;
  const talkLimit = options.talkLimitMs ?? 60_000;
  const maxPerRoom = options.maxPerRoom ?? 100;
  const pingEvery = options.pingIntervalMs ?? 20_000;
  const maxBuffered = options.maxBufferedBytes ?? 64 * 1024;
  const now = options.now ?? (() => Date.now());

  const rooms = new Map<string, Map<string, Peer>>();
  const stats = { framesRelayed: 0, bytesRelayed: 0 };
  const wss = new WebSocketServer({ noServer: true, maxPayload: Math.max(2048, maxFrame + 16) });

  const send = (peer: Peer, text: string) => {
    if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(text);
  };
  const others = (peer: Peer) => [...(rooms.get(peer.room)?.values() ?? [])].filter((p) => p !== peer);

  const setTalking = (peer: Peer, on: boolean) => {
    if (peer.talking === on) return;
    peer.talking = on;
    if (peer.turn) clearTimeout(peer.turn);
    peer.turn = null;
    if (on) peer.turn = setTimeout(() => setTalking(peer, false), talkLimit);
    const msg = JSON.stringify({ t: "talk", i: peer.index, on });
    send(peer, msg);
    for (const p of others(peer)) send(p, msg);
  };

  const freeIndex = (members: Map<string, Peer>) => {
    const used = new Set([...members.values()].map((p) => p.index));
    let i = 0;
    while (used.has(i)) i++;
    return i;
  };

  const drop = (peer: Peer) => {
    const members = rooms.get(peer.room);
    if (!members || members.get(peer.identity) !== peer) return;
    members.delete(peer.identity);
    if (peer.turn) clearTimeout(peer.turn);
    peer.turn = null;
    peer.talking = false;
    if (members.size === 0) rooms.delete(peer.room);
    else for (const p of members.values()) send(p, JSON.stringify({ t: "leave", i: peer.index }));
  };

  const closePeer = (peer: Peer, code: number, notice?: string) => {
    if (notice) send(peer, notice);
    drop(peer);
    peer.ws.close(code);
  };

  const onFrame = (peer: Peer, data: Buffer) => {
    if (!peer.pub || !peer.talking || data.length < 4 || data.length > maxFrame) return;
    const t = now();
    if (t - peer.windowStart >= 1000) {
      peer.windowStart = t;
      peer.windowFrames = 0;
    }
    if (++peer.windowFrames > maxFps) return;
    const out = Buffer.allocUnsafe(data.length + 1);
    out[0] = peer.index;
    data.copy(out, 1);
    for (const p of others(peer)) {
      if (p.ws.readyState !== WebSocket.OPEN || p.ws.bufferedAmount > maxBuffered) continue;
      p.ws.send(out, { binary: true });
      stats.framesRelayed++;
      stats.bytesRelayed += out.length;
    }
  };

  const onText = (peer: Peer, text: string) => {
    if (text.length > 256) return;
    let msg: { t?: unknown; on?: unknown };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg?.t === "talk" && typeof msg.on === "boolean") {
      if (peer.pub) setTalking(peer, msg.on);
    } else if (msg?.t === "ping") send(peer, '{"t":"pong"}');
  };

  const attach = (ws: WebSocket, claims: { sub: string; room: string; pub: boolean }) => {
    const previous = rooms.get(claims.room)?.get(claims.sub);
    if (previous) closePeer(previous, CLOSE_REPLACED);
    let members = rooms.get(claims.room);
    if (!members) rooms.set(claims.room, (members = new Map()));
    const peer: Peer = {
      ws, room: claims.room, identity: claims.sub, index: freeIndex(members), pub: claims.pub,
      talking: false, turn: null, windowStart: 0, windowFrames: 0, alive: true,
    };
    const existing = [...members.values()].map((p) => ({ i: p.index, id: p.identity }));
    members.set(peer.identity, peer);
    send(peer, JSON.stringify({ t: "hello", you: peer.index, peers: existing }));
    for (const p of others(peer)) send(p, JSON.stringify({ t: "join", i: peer.index, id: peer.identity }));
    ws.on("pong", () => (peer.alive = true));
    ws.on("message", (data: RawData, isBinary: boolean) => {
      peer.alive = true;
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      if (isBinary) onFrame(peer, buf);
      else onText(peer, buf.toString("utf8"));
    });
    ws.on("close", () => drop(peer));
    ws.on("error", () => drop(peer));
  };

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => undefined);
    const url = new URL(req.url ?? "/", "http://relay");
    if (url.pathname !== "/ws") return reject(socket, 404, "Not Found");
    const claims = verifyToken(url.searchParams.get("token") ?? "", options.secret, Math.floor(now() / 1000));
    if (!claims) return reject(socket, 401, "Unauthorized");
    const members = rooms.get(claims.room);
    if (members && !members.has(claims.sub) && members.size >= maxPerRoom) return reject(socket, 503, "Room Full");
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws, claims));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 4096) {
          reject(new Error("too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  const snapshot = (): RelayStats => {
    let connections = 0;
    for (const m of rooms.values()) connections += m.size;
    return { rooms: rooms.size, connections, framesRelayed: stats.framesRelayed, bytesRelayed: stats.bytesRelayed };
  };

  const server: Server = createServer((req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return void res.end("ok");
    }
    const authed = () => {
      const given = req.headers["x-relay-secret"];
      return options.adminSecret !== "" && typeof given === "string" && safeEqual(given, options.adminSecret);
    };
    if (req.method === "GET" && path === "/admin/stats") return authed() ? reply(200, snapshot()) : reply(401, { error: "unauthenticated" });
    if (req.method === "POST" && path === "/admin/kick") {
      if (!authed()) return reply(401, { error: "unauthenticated" });
      readBody(req).then(
        (raw) => {
          let body: { room?: unknown; identity?: unknown } | null = null;
          try {
            body = JSON.parse(raw);
          } catch {
            body = null;
          }
          const room = typeof body?.room === "string" ? body.room.toLowerCase() : "";
          const identity = body?.identity;
          if (!UUID.test(room) || (identity !== undefined && (typeof identity !== "string" || !IDENTITY.test(identity)))) {
            return reply(400, { error: "invalid_request" });
          }
          const members = rooms.get(room);
          const targets = !members ? [] : identity === undefined ? [...members.values()] : [members.get(identity)].filter((p): p is Peer => !!p);
          for (const p of targets) closePeer(p, CLOSE_KICKED, '{"t":"kicked"}');
          reply(200, { closed: targets.length });
        },
        () => reply(413, { error: "too_large" }),
      );
      return;
    }
    reply(404, { error: "not_found" });
  });
  server.on("upgrade", upgrade);

  const heartbeat = setInterval(() => {
    for (const members of rooms.values()) {
      for (const peer of members.values()) {
        if (!peer.alive) {
          drop(peer);
          peer.ws.terminate();
        } else {
          peer.alive = false;
          peer.ws.ping();
        }
      }
    }
  }, pingEvery);
  heartbeat.unref();

  return {
    server,
    stats: snapshot,
    async close() {
      clearInterval(heartbeat);
      for (const members of [...rooms.values()]) for (const p of [...members.values()]) p.ws.terminate();
      rooms.clear();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
