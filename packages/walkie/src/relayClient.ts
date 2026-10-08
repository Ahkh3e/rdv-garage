import type { VoiceStatus } from "@rdv/core/voice";
import { type AudioFrame, decodeAudioFrame, parseServerMessage, PING_MESSAGE, type ServerMessage, talkMessage } from "./wire";

export interface SocketLike {
  binaryType: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(): void;
}

export interface RelayTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface RelayClientDeps {
  open(url: string): SocketLike;
  timers?: RelayTimers;
  retryDelaysMs?: number[];
  pingEveryMs?: number;
  deadAfterMs?: number;
  now?: () => number;
}

export const RETRY_DELAYS_MS = [500, 1000, 2000];
const OPEN = 1;

export const relayUrl = (base: string, token: string) =>
  `${base.replace(/\/+$/, "").replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/ws?token=${encodeURIComponent(token)}`;

const defaultTimers: RelayTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// One WebSocket to the relay. A connection that drops after it was up is retried with the same token a few times;
// when that runs out, or the relay kicked it, the status becomes "disconnected" and the caller joins again with a fresh token.
export function createRelayClient(deps: RelayClientDeps) {
  const timers = deps.timers ?? defaultTimers;
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  const pingEvery = deps.pingEveryMs ?? 15_000;
  const deadAfter = deps.deadAfterMs ?? 40_000;
  const now = deps.now ?? Date.now;

  let url = "";
  let socket: SocketLike | null = null;
  let generation = 0;
  let wasUp = false;
  let attempt = 0;
  let lastHeard = 0;
  let retryHandle: unknown = null;
  let pingHandle: unknown = null;
  let settleInitial: { resolve(): void; reject(e: Error): void } | null = null;
  const status = new Set<(s: VoiceStatus) => void>();
  const messages = new Set<(m: ServerMessage) => void>();
  const frames = new Set<(f: AudioFrame) => void>();
  const opened = new Set<() => void>();
  const emit = (s: VoiceStatus) => status.forEach((fn) => fn(s));

  const stopTimers = () => {
    if (retryHandle !== null) timers.clear(retryHandle);
    if (pingHandle !== null) timers.clear(pingHandle);
    retryHandle = pingHandle = null;
  };

  const closeSocket = () => {
    const s = socket;
    socket = null;
    generation++;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      try {
        s.close();
      } catch {}
    }
  };

  const schedulePing = (gen: number) => {
    pingHandle = timers.set(() => {
      if (gen !== generation || !socket) return;
      if (now() - lastHeard > deadAfter) return lost(gen);
      if (socket.readyState === OPEN) socket.send(PING_MESSAGE);
      schedulePing(gen);
    }, pingEvery);
  };

  function lost(gen: number) {
    if (gen !== generation) return;
    stopTimers();
    closeSocket();
    if (!wasUp) {
      settleInitial?.reject(new Error("relay connection failed"));
      settleInitial = null;
      return;
    }
    if (attempt >= delays.length) {
      wasUp = false;
      emit("disconnected");
      return;
    }
    emit("reconnecting");
    retryHandle = timers.set(() => {
      retryHandle = null;
      attempt++;
      open();
    }, delays[attempt]!);
  }

  function open() {
    const gen = ++generation;
    const s = deps.open(url);
    socket = s;
    s.binaryType = "arraybuffer";
    s.onmessage = (event) => {
      if (gen !== generation) return;
      lastHeard = now();
      const data = event.data;
      if (typeof data === "string") {
        const m = parseServerMessage(data);
        if (!m) return;
        if (m.t === "hello") {
          const first = settleInitial;
          settleInitial = null;
          wasUp = true;
          attempt = 0;
          if (first) first.resolve();
          else emit("connected");
          opened.forEach((fn) => fn());
        } else if (m.t === "kicked") {
          wasUp = false;
          stopTimers();
          closeSocket();
          emit("disconnected");
          return;
        }
        messages.forEach((fn) => fn(m));
      } else {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
        const f = bytes && decodeAudioFrame(bytes);
        if (f) frames.forEach((fn) => fn(f));
      }
    };
    s.onopen = () => {
      if (gen !== generation) return;
      lastHeard = now();
      if (pingHandle === null) schedulePing(gen);
    };
    s.onclose = () => lost(gen);
    s.onerror = () => lost(gen);
  }

  return {
    connect(base: string, token: string): Promise<void> {
      stopTimers();
      closeSocket();
      url = relayUrl(base, token);
      wasUp = false;
      attempt = 0;
      settleInitial?.reject(new Error("superseded"));
      return new Promise<void>((resolve, reject) => {
        settleInitial = { resolve, reject };
        try {
          open();
        } catch (e) {
          settleInitial = null;
          reject(e as Error);
        }
      });
    },
    disconnect() {
      stopTimers();
      closeSocket();
      wasUp = false;
      settleInitial?.reject(new Error("disconnected"));
      settleInitial = null;
    },
    connected: () => wasUp && socket?.readyState === OPEN,
    setTalk(on: boolean) {
      if (socket?.readyState === OPEN) socket.send(talkMessage(on));
    },
    sendFrame(bytes: Uint8Array) {
      if (socket?.readyState === OPEN) socket.send(bytes);
    },
    onStatus: (fn: (s: VoiceStatus) => void) => (status.add(fn), () => void status.delete(fn)),
    onMessage: (fn: (m: ServerMessage) => void) => (messages.add(fn), () => void messages.delete(fn)),
    onFrame: (fn: (f: AudioFrame) => void) => (frames.add(fn), () => void frames.delete(fn)),
    onOpen: (fn: () => void) => (opened.add(fn), () => void opened.delete(fn)),
  };
}

export type RelayClient = ReturnType<typeof createRelayClient>;
