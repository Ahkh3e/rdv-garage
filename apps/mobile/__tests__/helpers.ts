import type { AppConfig, Backend } from "@rdv/core";
import { AppError, createShell } from "@rdv/core";
import { modules } from "../src/modules";

type Handler = (args: Record<string, unknown>) => unknown;

export const config: AppConfig = { supabaseUrl: "http://x", supabaseKey: "k", linkDomain: "links.test", flags: {} };

export interface FakeBackend extends Backend {
  calls: { name: string; args: unknown }[];
  setUser(id: string | null): void;
  handlers: Record<string, Handler>;
  invoked: { name: string; body: unknown }[];
}

export function makeBackend(initialUser: string | null, handlers: Record<string, Handler> = {}): FakeBackend {
  let user = initialUser;
  const listeners = new Set<(id: string | null) => void>();
  const calls: FakeBackend["calls"] = [];
  const invoked: FakeBackend["invoked"] = [];
  const fake: FakeBackend = {
    calls,
    invoked,
    handlers,
    setUser(id) {
      user = id;
      listeners.forEach((fn) => fn(id));
    },
    auth: {
      signIn: jest.fn(async () => {
        fake.setUser("user-1");
      }),
      signOut: jest.fn(async () => fake.setUser(null)),
      requestPasswordReset: jest.fn(async () => undefined),
      startRecovery: jest.fn(async () => undefined),
      completePasswordReset: jest.fn(async () => undefined),
      changePassword: jest.fn(async () => undefined),
      resendConfirmation: jest.fn(async () => undefined),
      listSessions: jest.fn(async () => []),
      revokeSession: jest.fn(async () => undefined),
    },
    async rpc(schema, name, args = {}) {
      calls.push({ name: `${schema}.${name}`, args });
      const handler = handlers[`${schema}.${name}`];
      if (!handler) throw new AppError("unknown_error", `no handler for ${schema}.${name}`);
      return handler(args) as never;
    },
    async invokePublic(name, body) {
      invoked.push({ name, body });
      const handler = handlers[`fn.${name}`];
      if (!handler) throw new AppError("unknown_error");
      return handler(body ?? {}) as never;
    },
    async invoke(name, body) {
      invoked.push({ name, body });
      const handler = handlers[`fn.${name}`];
      if (!handler) throw new AppError("unknown_error");
      return handler(body ?? {}) as never;
    },
    channel: () => ({ on: () => undefined, subscribe: () => undefined, send: async () => undefined, track: async () => undefined, untrack: async () => undefined, unsubscribe: async () => undefined }),
    avatarUrl: async () => null,
    uploadAvatar: async () => "path",
    userId: () => user,
    onAuthChange(fn) {
      listeners.add(fn);
      setTimeout(() => fn(user), 0);
      return () => listeners.delete(fn);
    },
  };
  return fake;
}

// The rdvs module is off unless a test asks for it, so other suites keep their own routes and slots.
export function makeShell(backend: Backend, flags: Record<string, boolean> = {}) {
  const shell = createShell({ ...config, flags: { rdvs: false, chat: false, ...flags } }, backend);
  for (const module of modules) module.register(shell);
  return shell;
}

export const profileRow = (over: Record<string, unknown> = {}) => ({ id: "user-1", handle: "tester", avatar_path: null, status: "active", ...over });
