import type { Ctx } from "../context";
import { check } from "../context";
import { assertCrewAddAllowed } from "../guard";
import { GuardError } from "../guard";
import { addMember, createSyntheticCrew, createSyntheticUser, crewOwner, findProfile, profileById } from "../lib";

export async function crewCreate(ctx: Ctx, opts: { owner?: string; members: number; name?: string }) {
  if (ctx.dryRun) return ctx.log(`Would create a synthetic crew with ${opts.members} extra member(s)${opts.owner ? ` owned by ${opts.owner}` : ""}.`);
  const owner = opts.owner ? await findProfile(ctx, opts.owner) : { ...(await createSyntheticUser(ctx)), is_synthetic: true };
  const ownerId = owner.id;
  const ownerSynthetic = "is_synthetic" in owner ? (owner.is_synthetic as boolean) : true;
  const crew = await createSyntheticCrew(ctx, ownerId, opts.name ?? `Sim ${Math.random().toString(36).slice(2, 7)}`);
  for (let i = 0; i < opts.members; i++) {
    const user = await createSyntheticUser(ctx);
    assertCrewAddAllowed(ctx.config, ownerSynthetic, true);
    await addMember(ctx, crew.id, user.id);
  }
  ctx.log(`crew ${crew.id} (link code ${crew.link_code})`);
  return crew;
}

export async function crewDelete(ctx: Ctx, opts: { id: string; confirmName?: string }) {
  const crew = await crewOwner(ctx, opts.id);
  if (!crew.is_synthetic && opts.confirmName !== crew.name) throw new GuardError(`"${crew.name}" is a real crew. Pass --confirm-name "${crew.name}" to delete it.`);
  if (ctx.dryRun) return ctx.log(`Would delete crew ${crew.name} (${crew.is_synthetic ? "synthetic" : "REAL"})`);
  check(await ctx.admin.schema("crews").rpc("dissolve", { p_crew: opts.id }), "dissolve");
  ctx.log(`deleted crew ${crew.name}`);
}

export async function crewAdd(ctx: Ctx, opts: { id: string; handle: string }) {
  const crew = await crewOwner(ctx, opts.id);
  const user = await findProfile(ctx, opts.handle);
  const owner = await profileById(ctx, crew.owner_id);
  assertCrewAddAllowed(ctx.config, owner.is_synthetic, user.is_synthetic);
  if (ctx.dryRun) return ctx.log(`Would add @${user.handle} to ${crew.name}`);
  await addMember(ctx, crew.id, user.id);
  ctx.log(`added @${user.handle} to ${crew.name}`);
}

export async function crewRemove(ctx: Ctx, opts: { id: string; handle: string }) {
  const crew = await crewOwner(ctx, opts.id);
  const user = await findProfile(ctx, opts.handle);
  if (user.id === crew.owner_id) throw new Error("That user owns the crew. Transfer or delete the crew instead.");
  if (ctx.dryRun) return ctx.log(`Would remove @${user.handle} from ${crew.name}`);
  check(await ctx.admin.schema("crews").rpc("drop_membership", { p_crew: crew.id, p_user: user.id }), "remove");
  ctx.log(`removed @${user.handle} from ${crew.name}`);
}
