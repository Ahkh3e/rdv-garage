import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config";
import type { AuthApi, Backend, ChannelLike, DeviceSession } from "./contracts";
import { AppError } from "./errors";
import type { Unsubscribe } from "./events";
import { createChunkedStorage, type KeyValueStore } from "./secureStorage";

function toAppError(error: { message?: string; status?: number; code?: string } | null | undefined, fallback = "unknown_error"): AppError {
  const message = error?.message ?? "";
  if (/^[a-z_]+$/.test(message)) return new AppError(message);
  if (/Failed to fetch|Network request failed|network/i.test(message)) return new AppError("network");
  return new AppError(fallback, message);
}

class Channel implements ChannelLike {
  constructor(private readonly channel: RealtimeChannel) {}
  on(event: string, fn: (payload: any) => void) {
    this.channel.on("broadcast", { event }, (message) => fn(message.payload));
  }
  subscribe(onStatus?: (status: "SUBSCRIBED" | "ERROR" | "CLOSED" | "TIMED_OUT") => void) {
    this.channel.subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus?.("SUBSCRIBED");
      else if (status === "CHANNEL_ERROR") onStatus?.("ERROR");
      else if (status === "CLOSED") onStatus?.("CLOSED");
      else if (status === "TIMED_OUT") onStatus?.("TIMED_OUT");
    });
  }
  async send(event: string, payload: Record<string, unknown>) {
    await this.channel.send({ type: "broadcast", event, payload });
  }
  async track(state: Record<string, unknown>) {
    await this.channel.track(state);
  }
  async untrack() {
    await this.channel.untrack();
  }
  async unsubscribe() {
    await this.channel.unsubscribe();
  }
}

export function createBackend(config: AppConfig, secureStore: KeyValueStore): Backend {
  const storage = createChunkedStorage(secureStore);
  const client: SupabaseClient = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  let currentUserId: string | null = null;

  const authApi: AuthApi = {
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) {
        if (/confirm/i.test(error.message)) throw new AppError("email_unconfirmed");
        if (/ban|suspend/i.test(error.message)) throw new AppError("suspended");
        if (/invalid/i.test(error.message)) throw new AppError("invalid_login");
        throw toAppError(error);
      }
    },
    async signOut() {
      await client.auth.signOut();
    },
    async requestPasswordReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `https://${config.linkDomain}/reset`,
      });
      if (error && !/rate/i.test(error.message)) throw toAppError(error);
      if (error) throw new AppError("rate_limited");
    },
    async startRecovery(accessToken, refreshToken) {
      const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) throw new AppError("reset_link_invalid");
    },
    async completePasswordReset(newPassword) {
      if (newPassword.length < 8) throw new AppError("password_too_short");
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw toAppError(error);
      // Supabase does not sign out other devices on a reset, so do it here.
      await client.schema("accounts").rpc("revoke_other_sessions");
    },
    async changePassword(current, next) {
      const { data, error } = await client.functions.invoke<any>("change-password", { body: { current, next } });
      if (error) {
        const code = await readFunctionError(error);
        throw new AppError(code);
      }
      if (data?.error) throw new AppError(data.error);
      // The server signs this device in again with the new password and signs the others out.
      if (data?.session) await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    },
    async resendConfirmation(email) {
      const { error } = await client.auth.resend({
        type: "signup",
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `https://${config.linkDomain}/confirm` },
      });
      if (error) throw new AppError(/rate/i.test(error.message) ? "rate_limited" : "unknown_error");
    },
    async listSessions(): Promise<DeviceSession[]> {
      const { data, error } = await client.schema("accounts").rpc("list_sessions");
      if (error) throw toAppError(error);
      return (data as any[]).map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        userAgent: row.user_agent,
        isCurrent: row.is_current,
      }));
    },
    async revokeSession(id) {
      const { error } =
        id === "others"
          ? await client.schema("accounts").rpc("revoke_other_sessions")
          : await client.schema("accounts").rpc("revoke_session", { p_id: id });
      if (error) throw toAppError(error);
    },
  };

  async function readFunctionError(error: unknown): Promise<string> {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as { error?: unknown } | null;
        if (typeof body?.error === "string") return body.error;
      } catch {
        // fall through
      }
    }
    return "unknown_error";
  }

  async function invokeFunction<T>(name: string, body: Record<string, unknown> | undefined, authed: boolean): Promise<T> {
    const headers = authed ? undefined : { Authorization: `Bearer ${config.supabaseKey}` };
    const { data, error } = await client.functions.invoke<any>(name, { body: body ?? {}, headers });
    if (error) throw new AppError(await readFunctionError(error));
    if (data?.error) throw new AppError(data.error);
    return data as T;
  }

  client.auth.onAuthStateChange((_event, session) => {
    currentUserId = session?.user.id ?? null;
  });

  return {
    auth: authApi,
    async rpc<T>(schema: string, name: string, args: Record<string, unknown> = {}) {
      const { data, error } = await client.schema(schema).rpc(name, args);
      if (error) throw toAppError(error);
      return data as T;
    },
    invokePublic: (name, body) => invokeFunction(name, body, false),
    invoke: (name, body) => invokeFunction(name, body, true),
    channel(name) {
      return new Channel(client.channel(name, { config: { private: true, broadcast: { self: false }, presence: { key: currentUserId ?? undefined } } }));
    },
    async avatarUrl(path) {
      const { data, error } = await client.storage.from("avatars").createSignedUrl(path, 3600);
      return error ? null : data.signedUrl;
    },
    async uploadAvatar(userId, data, contentType) {
      const path = `${userId}/avatar-${Date.now()}.${contentType === "image/png" ? "png" : "jpg"}`;
      const { error } = await client.storage.from("avatars").upload(path, data, { contentType, upsert: true });
      if (error) throw toAppError(error);
      return path;
    },
    userId: () => currentUserId,
    onAuthChange(fn): Unsubscribe {
      client.auth.getSession().then(({ data }) => {
        currentUserId = data.session?.user.id ?? null;
        fn(currentUserId);
      });
      const { data } = client.auth.onAuthStateChange((_event, session) => fn(session?.user.id ?? null));
      return () => data.subscription.unsubscribe();
    },
  };
}
