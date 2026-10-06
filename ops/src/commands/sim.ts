import { torontoWeekStart, previousWeekStart } from "@rdv/core/week";
import { haversineMeters } from "@rdv/core/geo";
import { type Ctx, anonClient, check, randomPassword } from "../context";
import { addMember, createSyntheticCrew, createSyntheticUser, crewMembers, findProfile, type Profile } from "../lib";
import { ROUTES, Walker, type RouteStyle } from "../routes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SimLiveOptions {
  crewId?: string;
  users: number;
  durationSec: number;
  route: RouteStyle;
  posIntervalMs?: number;
  checkpointIntervalMs?: number;
  firstCheckpointMs?: number;
  staleUsers?: number;
  seed?: number;
}

export interface SimLiveResult {
  crewId: string;
  users: { handle: string; sessionId: string; maxKmh: number; distanceM: number; sent: number }[];
}

async function ensureSyntheticMembers(ctx: Ctx, crewId: string, want: number): Promise<Profile[]> {
  const members = (await crewMembers(ctx, crewId)).filter((m) => m.is_synthetic && m.status === "active");
  while (members.length < want) {
    const created = await createSyntheticUser(ctx);
    await addMember(ctx, crewId, created.id);
    members.push({ id: created.id, handle: created.handle, status: "active", is_synthetic: true, avatar_path: null, invited_by: null });
  }
  return members.slice(0, want);
}

// Fake members drive routes through the same paths the app uses: real sign-in, start_session, private channels, checkpoints.
export async function simLive(ctx: Ctx, opts: SimLiveOptions): Promise<SimLiveResult> {
  if (ctx.dryRun) {
    ctx.log(`Would simulate ${opts.users} live user(s) on ${opts.route} routes for ${opts.durationSec}s in ${opts.crewId ? `crew ${opts.crewId}` : "a new synthetic crew"}.`);
    return { crewId: opts.crewId ?? "", users: [] };
  }
  let crewId = opts.crewId;
  if (!crewId) {
    const owner = await createSyntheticUser(ctx);
    crewId = (await createSyntheticCrew(ctx, owner.id, `Sim ${Math.random().toString(36).slice(2, 7)}`)).id;
    ctx.log(`created synthetic crew ${crewId}`);
  }
  const members = await ensureSyntheticMembers(ctx, crewId, opts.users);
  const posMs = opts.posIntervalMs ?? 3000;
  const checkpointMs = opts.checkpointIntervalMs ?? 30000;
  const firstCheckpointMs = opts.firstCheckpointMs ?? 2000;
  const seed = opts.seed ?? Date.now();

  interface Driver {
    profile: Profile;
    client: ReturnType<typeof anonClient>;
    channel: ReturnType<ReturnType<typeof anonClient>["channel"]>;
    sessionId: string;
    walker: Walker;
    maxKmh: number;
    distanceM: number;
    last: { lat: number; lng: number } | null;
    sent: number;
    quiet: boolean;
  }
  const drivers: Driver[] = [];

  for (const [i, profile] of members.entries()) {
    // Synthetic users get a throwaway password so the simulator can sign in as them.
    const email = (await ctx.admin.auth.admin.getUserById(profile.id)).data.user?.email;
    if (!email) throw new Error(`no email for @${profile.handle}`);
    const password = randomPassword();
    check({ data: null, error: (await ctx.admin.auth.admin.updateUserById(profile.id, { password })).error }, "set password");
    const client = anonClient(ctx);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`sign in @${profile.handle}: ${signedIn.error.message}`);
    const sessionId = check(await client.schema("live").rpc("start_session", { p_crew_ids: [crewId], p_platform: "sim" }), "start_session") as string;
    client.realtime.setAuth(signedIn.data.session?.access_token ?? null);
    const channel = client.channel(`crew:${crewId}`, { config: { private: true, broadcast: { self: false } } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`channel timeout for @${profile.handle}`)), 15000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        } else if (status === "CHANNEL_ERROR") {
          clearTimeout(timer);
          reject(new Error(`channel error for @${profile.handle}`));
        }
      });
    });
    const walker = new Walker(ROUTES[opts.route], opts.route, seed + i * 101, i * 2);
    drivers.push({ profile, client, channel, sessionId, walker, maxKmh: 0, distanceM: 0, last: null, sent: 0, quiet: i < (opts.staleUsers ?? 0) ? false : false });
  }
  const staleCount = Math.min(opts.staleUsers ?? 0, drivers.length);
  ctx.log(`${drivers.length} simulated driver(s) live in crew ${crewId}`);

  const start = Date.now();
  let lastCheckpoint = start - checkpointMs + firstCheckpointMs;
  let lastStep = start;
  while (Date.now() - start < opts.durationSec * 1000) {
    await sleep(posMs);
    const now = Date.now();
    const dt = (now - lastStep) / 1000;
    lastStep = now;
    const doCheckpoint = now - lastCheckpoint >= checkpointMs;
    if (doCheckpoint) lastCheckpoint = now;
    for (const [i, d] of drivers.entries()) {
      // The last few drivers go silent on purpose so the stale-session sweep can be exercised.
      d.quiet = i >= drivers.length - staleCount && now - start > opts.durationSec * 500;
      if (d.quiet) continue;
      const step = d.walker.step(dt);
      if (d.last) d.distanceM += haversineMeters(d.last, step);
      d.last = { lat: step.lat, lng: step.lng };
      d.maxKmh = Math.max(d.maxKmh, step.speedKmh);
      await d.channel.send({ type: "broadcast", event: "pos", payload: { user_id: d.profile.id, lat: step.lat, lng: step.lng, heading: step.heading, ts: now } });
      d.sent++;
      if (doCheckpoint) {
        await d.client.schema("live").rpc("checkpoint_session", { p_session: d.sessionId, p_max_speed_kmh: d.maxKmh, p_distance_m: d.distanceM });
      }
    }
  }

  for (const [i, d] of drivers.entries()) {
    const abandoned = i >= drivers.length - staleCount;
    if (!abandoned) {
      await d.channel.send({ type: "broadcast", event: "stop", payload: { user_id: d.profile.id, ts: Date.now() } });
      await d.client.schema("live").rpc("checkpoint_session", { p_session: d.sessionId, p_max_speed_kmh: d.maxKmh, p_distance_m: d.distanceM });
      await d.client.schema("live").rpc("end_session", { p_session: d.sessionId });
    }
    await d.client.removeAllChannels();
  }
  const result: SimLiveResult = {
    crewId,
    users: drivers.map((d) => ({ handle: d.profile.handle, sessionId: d.sessionId, maxKmh: Math.round(d.maxKmh), distanceM: Math.round(d.distanceM), sent: d.sent })),
  };
  ctx.log(JSON.stringify(result, null, 2));
  return result;
}

// Writes finished sessions with random speeds for this week (and optionally last week) so the Board has data.
export async function simLeaderboard(ctx: Ctx, opts: { crewId: string; previousWeek?: boolean; seed?: number }) {
  if (ctx.dryRun) return ctx.log(`Would write leaderboard data for crew ${opts.crewId}.`);
  const members = (await crewMembers(ctx, opts.crewId)).filter((m) => m.is_synthetic && m.status === "active");
  if (members.length === 0) throw new Error("That crew has no synthetic members. Run crew create or sim live first.");
  const thisWeek = torontoWeekStart(Date.now());
  const weeks = opts.previousWeek ? [thisWeek, previousWeekStart(thisWeek)] : [thisWeek];
  let rows = 0;
  for (const member of members) {
    for (const week of weeks) {
      const startedAt = new Date(Date.now() - (week === thisWeek ? 3600_000 : 7 * 86400_000)).toISOString();
      const session = await ctx.admin.schema("live").from("sessions").insert({ user_id: member.id, started_at: startedAt, ended_at: startedAt, last_seen_at: startedAt, platform: "sim" }).select("id").single();
      if (session.error) throw new Error(`session: ${session.error.message}`);
      const sid = session.data.id as string;
      const shared = await ctx.admin.schema("live").from("session_crews").insert({ session_id: sid, crew_id: opts.crewId });
      if (shared.error) throw new Error(`session_crews: ${shared.error.message}`);
      const speed = 80 + Math.random() * 140;
      const segment = await ctx.admin.schema("live").from("segments").insert({ session_id: sid, week_start: week, max_speed_kmh: speed, max_speed_at: startedAt, distance_m: 5000 + Math.random() * 60000 });
      if (segment.error) throw new Error(`segment: ${segment.error.message}`);
      rows++;
    }
  }
  ctx.log(`wrote ${rows} segment(s) for ${members.length} synthetic member(s)`);
  return rows;
}

// Builds referral chains: synthetic members create invites and synthetic users join through them.
export async function simInvites(ctx: Ctx, opts: { count: number; depth?: number; inviter?: string }) {
  if (ctx.dryRun) return ctx.log(`Would build ${opts.count} synthetic referral(s).`);
  let inviter: Profile;
  if (opts.inviter) inviter = await findProfile(ctx, opts.inviter);
  else {
    const first = await createSyntheticUser(ctx);
    inviter = await findProfile(ctx, first.handle);
  }
  if (ctx.config.environment === "production" && !inviter.is_synthetic) throw new Error("In production the inviter must be synthetic.");
  const chain: string[] = [inviter.handle];
  for (let i = 0; i < opts.count; i++) {
    const code = Array.from({ length: 12 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
    const invite = await ctx.admin.schema("referral").from("invites").insert({ inviter_id: inviter.id, code, expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() }).select("id").single();
    if (invite.error) throw new Error(`invite: ${invite.error.message}`);
    const joined = await createSyntheticUser(ctx, inviter.id, invite.data.id as string);
    chain.push(joined.handle);
    if ((opts.depth ?? 1) > 1) inviter = await findProfile(ctx, joined.handle);
  }
  ctx.log(`referral chain: ${chain.map((h) => `@${h}`).join(" -> ")}`);
  return chain;
}
