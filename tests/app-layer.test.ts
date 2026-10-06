import { describe, expect, it } from "vitest";
import { createBackend } from "@rdv/core/backend";
import { AppError } from "@rdv/core/errors";
import { createStore } from "@rdv/core/store";
import { torontoWeekStart } from "@rdv/core/week";
import { loadCrews } from "@rdv/crews/data";
import { LiveEngine } from "@rdv/live-location/engine";
import { ChannelHub } from "@rdv/live-location/hub";
import { startReceiver } from "@rdv/live-location/receiver";
import { admin, ANON_KEY, API_URL, callOk, createUser, sleep, uniq } from "./helpers";

// These tests drive the app's own code (the Backend, crews data loader, live engine, channel hub, receiver)
// against the local stack, so a wrong function name or argument in the app fails here.

const MAILPIT = "http://127.0.0.1:54324";
const config = { supabaseUrl: API_URL, supabaseKey: ANON_KEY, linkDomain: "links.test", flags: {} };

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => data.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void data.set(k, v),
    deleteItemAsync: async (k: string) => void data.delete(k),
  };
}

const newBackend = () => createBackend(config, memoryStore());

async function register(email: string, handle: string, code: string) {
  const backend = newBackend();
  return backend.invokePublic<{ status: string }>("register", { invite_code: code, handle, email, password: "longenough1", terms_version: "v1", age_confirmed: true });
}

describe("app backend: accounts and referral", () => {
  it("registers, signs in, reads the profile, and manages invites with the app's own calls", async () => {
    const founder = await createUser();
    const fb = newBackend();
    await fb.auth.signIn(founder.email, founder.password);
    const [invite] = await fb.rpc<{ id: string; code: string }[]>("referral", "create_invite");
    expect(await newBackend().rpc("referral", "check_invite", { p_code: invite!.code })).toBe("valid");

    const handle = uniq("app");
    const email = `${handle}@example.test`;
    expect((await register(email, handle, invite!.code)).status).toBe("confirmed");

    const b = newBackend();
    await b.auth.signIn(email, "longenough1");
    const [me] = await b.rpc<{ id: string; handle: string; status: string }[]>("accounts", "my_profile");
    expect(me).toMatchObject({ handle, status: "active" });
    expect(b.userId()).toBe(me!.id);

    const list = await fb.rpc<{ joined: { handle: string }[] }[]>("referral", "list_my_invites");
    expect(list[0]!.joined.map((j) => j.handle)).toContain(handle);
    await fb.rpc("referral", "revoke_invite", { p_id: invite!.id });
    expect(await newBackend().rpc("referral", "check_invite", { p_code: invite!.code })).toBe("revoked");
  });

  it("maps server errors to stable codes", async () => {
    const b = newBackend();
    await expect(b.auth.signIn("nobody@example.test", "wrong-password")).rejects.toMatchObject({ code: "invalid_login" });
    await expect(b.invokePublic("register", { invite_code: "ZZZZZZZZZZZZ", handle: uniq("x"), email: `${uniq("e")}@example.test`, password: "longenough1", terms_version: "v1", age_confirmed: true })).rejects.toMatchObject({ code: "invalid_invite" });
    const u = await createUser();
    const ub = newBackend();
    await ub.auth.signIn(u.email, u.password);
    await expect(ub.rpc("crews", "join_crew", { p_link_code: "NOPE" })).rejects.toBeInstanceOf(AppError);
    await expect(ub.rpc("crews", "join_crew", { p_link_code: "NOPE" })).rejects.toMatchObject({ code: "invalid_crew_link" });
  });

  it("changes a password through the Edge Function and signs out other devices", async () => {
    const u = await createUser();
    const a = newBackend();
    const other = newBackend();
    await a.auth.signIn(u.email, u.password);
    await other.auth.signIn(u.email, u.password);
    await expect(a.auth.changePassword("wrong-password-1", "brand-new-pass")).rejects.toMatchObject({ code: "wrong_password" });
    await a.auth.changePassword(u.password, "brand-new-pass");
    const sessions = await a.auth.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.isCurrent).toBe(true);
    await expect(newBackend().auth.signIn(u.email, u.password)).rejects.toBeInstanceOf(AppError);
    await newBackend().auth.signIn(u.email, "brand-new-pass");
  });

  it("lists devices, revokes one, and revokes all the others", async () => {
    const u = await createUser();
    const a = newBackend();
    const b = newBackend();
    const c = newBackend();
    for (const x of [a, b, c]) await x.auth.signIn(u.email, u.password);
    const before = await a.auth.listSessions();
    expect(before.length).toBeGreaterThanOrEqual(3);
    const target = before.find((s) => !s.isCurrent)!;
    await a.auth.revokeSession(target.id);
    expect((await a.auth.listSessions()).length).toBe(before.length - 1);
    await a.auth.revokeSession("others");
    expect((await a.auth.listSessions()).length).toBe(1);
  });

  it("resets a forgotten password from the emailed link", async () => {
    const u = await createUser();
    const b = newBackend();
    await b.auth.requestPasswordReset(u.email);
    let link: string | undefined;
    for (let i = 0; i < 20 && !link; i++) {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${u.email}`)}`);
      const found = ((await res.json()) as { messages?: { ID: string }[] }).messages?.[0];
      if (found) {
        const text = ((await (await fetch(`${MAILPIT}/api/v1/message/${found.ID}`)).json()) as { Text: string }).Text;
        link = text.match(/https?:\/\/[^\s)>\]]+/)?.[0];
      } else await sleep(400);
    }
    expect(link).toBeTruthy();
    const verify = await fetch(link!, { redirect: "manual" });
    const location = verify.headers.get("location") ?? "";
    const hash = location.split("#")[1] ?? "";
    const params = new URLSearchParams(hash);
    expect(params.get("access_token")).toBeTruthy();

    const other = newBackend();
    await other.auth.signIn(u.email, u.password);
    const recovered = newBackend();
    await recovered.auth.startRecovery(params.get("access_token")!, params.get("refresh_token")!);
    await recovered.auth.completePasswordReset("a-brand-new-password");
    // Every other device was signed out by the reset; only the recovery session is left.
    const left = await recovered.auth.listSessions();
    expect(left.length).toBe(1);
    expect(left[0]!.isCurrent).toBe(true);
    void other;
    await expect(newBackend().auth.signIn(u.email, u.password)).rejects.toBeInstanceOf(AppError);
    await newBackend().auth.signIn(u.email, "a-brand-new-password");
  });
});

describe("app backend: crews, avatars, live", () => {
  it("loads crews into the shared context in the shape the UI expects and persists selection", async () => {
    const owner = await createUser();
    const member = await createUser();
    const b = newBackend();
    await b.auth.signIn(owner.email, owner.password);
    const [crew] = await b.rpc<{ id: string; link_code: string }[]>("crews", "create_crew", { p_name: "App Crew", p_description: "hello" });
    const mb = newBackend();
    await mb.auth.signIn(member.email, member.password);
    await mb.rpc("crews", "join_crew", { p_link_code: crew!.link_code });

    const crewState = createStore<{ loaded: boolean; crews: any[]; selected: string[] }>({ loaded: false, crews: [], selected: [] });
    const shell: any = { backend: b, crewContext: { setCrews: (crews: any[]) => crewState.set({ loaded: true, crews, selected: crews.filter((c) => c.selected).map((c) => c.id) }) } };
    await loadCrews(shell);
    const state = crewState.get();
    expect(state.crews[0]).toMatchObject({ name: "App Crew", role: "owner", linkCode: crew!.link_code, selected: true });
    expect(state.crews[0].members.map((m: { handle: string }) => m.handle).sort()).toEqual([owner.handle, member.handle].sort());
    await b.rpc("crews", "set_selected_crews", { p_crew_ids: [] });
    await loadCrews(shell);
    expect(crewState.get().selected).toEqual([]);
  });

  it("uploads an avatar and shows it to crew mates only", async () => {
    const owner = await createUser();
    const mate = await createUser();
    const stranger = await createUser();
    const ob = newBackend();
    await ob.auth.signIn(owner.email, owner.password);
    const [crew] = await ob.rpc<{ link_code: string }[]>("crews", "create_crew", { p_name: "Avatar Crew" });
    const mb = newBackend();
    await mb.auth.signIn(mate.email, mate.password);
    await mb.rpc("crews", "join_crew", { p_link_code: crew!.link_code });
    const sb = newBackend();
    await sb.auth.signIn(stranger.email, stranger.password);

    const bytes = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="), (c) => c.charCodeAt(0));
    const path = await ob.uploadAvatar(ob.userId()!, bytes.buffer, "image/jpeg");
    await ob.rpc("accounts", "update_profile", { p_avatar_path: path });
    expect(await ob.avatarUrl(path)).toMatch(/^http/);
    expect(await mb.avatarUrl(path)).toMatch(/^http/);
    expect(await sb.avatarUrl(path)).toBeNull();
    await expect(ob.rpc("accounts", "update_profile", { p_avatar_path: `${stranger.id}/x.jpg` })).rejects.toBeInstanceOf(AppError);
  });

  it("runs a live session end to end: engine, hub, receiver, leaderboard, stop", async () => {
    const driver = await createUser();
    const watcher = await createUser();
    const db = newBackend();
    const wb = newBackend();
    await db.auth.signIn(driver.email, driver.password);
    await wb.auth.signIn(watcher.email, watcher.password);
    const [crew] = await db.rpc<{ id: string; link_code: string }[]>("crews", "create_crew", { p_name: "Live Crew" });
    await wb.rpc("crews", "join_crew", { p_link_code: crew!.link_code });

    const watcherPositions = createStore<Record<string, any>>({});
    const watcherShell: any = {
      backend: wb,
      session: { get: () => ({ status: "signedIn" }), subscribe: () => () => undefined },
      live: { subscribe: () => () => undefined },
      crewContext: { store: { get: () => ({ selected: [crew!.id] }), subscribe: () => () => undefined } },
      locationStream: { publish: (p: any) => watcherPositions.set((s) => ({ ...s, [p.userId]: p })), remove: (id: string) => watcherPositions.set(({ [id]: _x, ...rest }) => rest), clear: () => watcherPositions.set({}) },
    };
    const watcherHub = new ChannelHub(wb);
    const stopReceiver = startReceiver(watcherShell, watcherHub, () => []);

    const driverHub = new ChannelHub(db);
    const release = driverHub.acquire(crew!.id);
    const published: any[] = [];
    const engine = new LiveEngine({
      userId: db.userId()!,
      now: () => Date.now(),
      weekOf: (ts) => torontoWeekStart(ts),
      startSession: (crewIds) => db.rpc<string>("live", "start_session", { p_crew_ids: crewIds, p_platform: "test" }),
      checkpoint: (id, speed, dist) => db.rpc<string>("live", "checkpoint_session", { p_session: id, p_max_speed_kmh: speed, p_distance_m: dist }),
      endSession: async (id) => void (await db.rpc("live", "end_session", { p_session: id })),
      broadcast: (crewId, event, payload) => driverHub.send(crewId, event, payload),
      publishSelf: (p) => void published.push(p),
    });
    await sleep(2500);
    await engine.start([crew!.id]);
    await sleep(500);
    const t = Date.now();
    engine.onFix({ lat: 43.65, lng: -79.38, speedMs: 40, heading: 80, accuracy: 5, ts: t });
    await sleep(1500);
    expect(Object.keys(watcherPositions.get())).toContain(db.userId());
    expect(watcherPositions.get()[db.userId()!]).toMatchObject({ lat: 43.65, lng: -79.38, heading: 80 });
    expect(JSON.stringify(watcherPositions.get())).not.toMatch(/speed/i);

    await engine.stop();
    await sleep(1500);
    expect(Object.keys(watcherPositions.get())).not.toContain(db.userId());

    const board = await wb.rpc<{ handle: string; top_speed_kmh: number }[]>("leaderboard", "weekly_top_speed", { p_crew: crew!.id });
    expect(board[0]).toMatchObject({ handle: driver.handle });
    expect(board[0]!.top_speed_kmh).toBeCloseTo(144, 0);

    release();
    stopReceiver();
    await db.channel("noop").unsubscribe().catch(() => undefined);
  }, 60000);

  it("suspended accounts get the suspended code from the app's calls", async () => {
    const u = await createUser();
    const b = newBackend();
    await b.auth.signIn(u.email, u.password);
    await admin.schema("accounts").rpc("suspend_user", { p_user: u.id });
    await expect(b.rpc("crews", "list_my_crews")).rejects.toMatchObject({ code: "suspended" });
    await callOk(admin, "accounts", "restore_user", { p_user: u.id }).catch(() => undefined);
  });
});
