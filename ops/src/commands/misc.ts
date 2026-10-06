import type { Ctx } from "../context";
import { check } from "../context";
import { deleteUserFully, syntheticProfiles } from "../lib";

// Runs user delete --synthetic, then removes every synthetic crew, their tombstones, and nothing else.
export async function purgeSynthetic(ctx: Ctx) {
  const users = (await syntheticProfiles(ctx)).filter((u) => u.status !== "deleted");
  if (ctx.dryRun) {
    const crews = await ctx.admin.schema("crews").from("crews").select("id").eq("is_synthetic", true);
    ctx.log(`Would delete ${users.length} synthetic user(s) and ${crews.data?.length ?? 0} synthetic crew(s).`);
    return;
  }
  for (const user of users) await deleteUserFully(ctx, user.id);

  const crews = await ctx.admin.schema("crews").from("crews").select("id").eq("is_synthetic", true);
  for (const crew of crews.data ?? []) check(await ctx.admin.schema("crews").rpc("dissolve", { p_crew: crew.id }), "dissolve");
  await ctx.admin.schema("crews").from("crews").delete().eq("is_synthetic", true);

  // Drop tombstones of synthetic users that nobody else hangs under.
  const tombstones = (await syntheticProfiles(ctx)).filter((p) => p.status === "deleted");
  let removed = 0;
  for (const t of tombstones) {
    const refs = await ctx.admin.schema("accounts").from("profiles").select("id", { count: "exact", head: true }).eq("invited_by", t.id);
    if ((refs.count ?? 0) > 0) continue;
    await ctx.admin.schema("referral").from("invites").delete().eq("inviter_id", t.id);
    const del = await ctx.admin.schema("accounts").from("profiles").delete().eq("id", t.id);
    if (!del.error) removed++;
  }
  ctx.log(`purged ${users.length} synthetic user(s), ${crews.data?.length ?? 0} crew(s), ${removed} tombstone(s)`);
  return { users: users.length, crews: crews.data?.length ?? 0, tombstones: removed };
}

export async function status(ctx: Ctx) {
  const count = async (schema: string, table: string, filter?: (q: any) => any) => {
    let q = ctx.admin.schema(schema).from(table).select("*", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: n, error } = await q;
    if (error) throw new Error(`${schema}.${table}: ${error.message}`);
    return n ?? 0;
  };
  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const out = {
    environment: ctx.config.environment,
    ping: (await ctx.admin.rpc("ping")).data,
    users: await count("accounts", "profiles", (q) => q.neq("status", "deleted")),
    syntheticUsers: await count("accounts", "profiles", (q) => q.eq("is_synthetic", true).neq("status", "deleted")),
    crews: await count("crews", "crews", (q) => q.eq("status", "active")),
    syntheticCrews: await count("crews", "crews", (q) => q.eq("status", "active").eq("is_synthetic", true)),
    liveSessions: await count("live", "sessions", (q) => q.is("ended_at", null).gt("last_seen_at", staleCutoff)),
    activeInvites: await count("referral", "invites", (q) => q.eq("status", "active").gt("expires_at", new Date().toISOString())),
  };
  ctx.log(JSON.stringify(out, null, 2));
  return out;
}
