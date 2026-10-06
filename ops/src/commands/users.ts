import { chmodSync, writeFileSync } from "node:fs";
import { type Ctx, check } from "../context";
import { assertInviterAllowed } from "../guard";
import { createSyntheticUser, deleteUserFully, findProfile, syntheticProfiles } from "../lib";

export async function userCreate(ctx: Ctx, opts: { count: number; invitedBy?: string; credentialsFile?: string }) {
  let inviterId: string | null = null;
  if (opts.invitedBy) {
    const inviter = await findProfile(ctx, opts.invitedBy);
    assertInviterAllowed(ctx.config, inviter.is_synthetic);
    inviterId = inviter.id;
  }
  if (ctx.dryRun) return ctx.log(`Would create ${opts.count} synthetic user(s)${inviterId ? ` invited by ${opts.invitedBy}` : ""}.`);
  const created = [];
  for (let i = 0; i < opts.count; i++) created.push(await createSyntheticUser(ctx, inviterId));
  for (const user of created) ctx.log(`created @${user.handle}`);
  if (opts.credentialsFile) {
    writeFileSync(opts.credentialsFile, created.map((u) => JSON.stringify({ handle: u.handle, email: u.email, password: u.password })).join("\n") + "\n", { mode: 0o600 });
    chmodSync(opts.credentialsFile, 0o600);
    ctx.log(`credentials written to ${opts.credentialsFile} (mode 600)`);
  }
  return created;
}

export async function userDelete(ctx: Ctx, opts: { handle?: string; synthetic?: boolean }) {
  const targets = opts.synthetic ? (await syntheticProfiles(ctx)).filter((p) => p.status !== "deleted") : [await findProfile(ctx, opts.handle ?? "")];
  if (!opts.synthetic && !opts.handle) throw new Error("Give a handle or --synthetic.");
  if (ctx.dryRun) {
    for (const t of targets) ctx.log(`Would delete @${t.handle} (${t.is_synthetic ? "synthetic" : "REAL"})`);
    return;
  }
  for (const t of targets) {
    await deleteUserFully(ctx, t.id);
    ctx.log(`deleted @${t.handle}`);
  }
  return targets.length;
}

export async function userSuspend(ctx: Ctx, handle: string) {
  const user = await findProfile(ctx, handle);
  if (ctx.dryRun) return ctx.log(`Would suspend @${user.handle}`);
  check(await ctx.admin.schema("accounts").rpc("suspend_user", { p_user: user.id }), "suspend");
  const ban = await ctx.admin.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
  if (ban.error) throw new Error(`ban: ${ban.error.message}`);
  check(await ctx.admin.schema("accounts").rpc("revoke_sessions_except", { p_user: user.id, p_keep: null }), "sessions");
  ctx.log(`suspended @${user.handle}`);
}

export async function userRestore(ctx: Ctx, handle: string) {
  const user = await findProfile(ctx, handle);
  if (ctx.dryRun) return ctx.log(`Would restore @${user.handle}`);
  check(await ctx.admin.schema("accounts").rpc("restore_user", { p_user: user.id }), "restore");
  const unban = await ctx.admin.auth.admin.updateUserById(user.id, { ban_duration: "none" });
  if (unban.error) throw new Error(`unban: ${unban.error.message}`);
  ctx.log(`restored @${user.handle}`);
}

export async function userShow(ctx: Ctx, handle: string) {
  const user = await findProfile(ctx, handle);
  const chain: string[] = [];
  let cursor: string | null = user.invited_by;
  for (let i = 0; cursor && i < 50; i++) {
    const { data } = await ctx.admin.schema("accounts").from("profiles").select("id,handle,invited_by").eq("id", cursor).maybeSingle();
    if (!data) break;
    chain.push(`@${data.handle as string}`);
    cursor = (data.invited_by as string | null) ?? null;
  }
  const crews = await ctx.admin.schema("crews").from("members").select("role,crew_id").eq("user_id", user.id);
  const invites = await ctx.admin.schema("referral").from("invites").select("id,code,status,expires_at").eq("inviter_id", user.id);
  const out = { handle: user.handle, id: user.id, status: user.status, synthetic: user.is_synthetic, invitedBy: chain, crews: crews.data ?? [], invites: invites.data ?? [] };
  ctx.log(JSON.stringify(out, null, 2));
  return out;
}

export async function inviteList(ctx: Ctx, handle: string) {
  const user = await findProfile(ctx, handle);
  const { data, error } = await ctx.admin.schema("referral").from("invites").select("id,code,status,created_at,expires_at,revoked_by").eq("inviter_id", user.id).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  for (const row of data ?? []) ctx.log(`${row.id}  ${row.code}  ${row.status}  expires ${row.expires_at}`);
  return data ?? [];
}

export async function inviteDisable(ctx: Ctx, id: string) {
  if (ctx.dryRun) return ctx.log(`Would disable invite ${id}`);
  const { error } = await ctx.admin.schema("referral").from("invites").update({ status: "disabled", revoked_by: "operator", revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  ctx.log(`disabled invite ${id}`);
}
