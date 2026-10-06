import { type Ctx, check, randomCode, randomHandle, randomPassword } from "./context";

export interface Profile {
  id: string;
  handle: string;
  status: string;
  is_synthetic: boolean;
  avatar_path: string | null;
  invited_by: string | null;
}

export async function findProfile(ctx: Ctx, handle: string): Promise<Profile> {
  const clean = handle.replace(/^@/, "").toLowerCase();
  const { data, error } = await ctx.admin.schema("accounts").from("profiles").select("id,handle,status,is_synthetic,avatar_path,invited_by").eq("handle", clean).maybeSingle();
  if (error) throw new Error(`find user: ${error.message}`);
  if (!data) throw new Error(`No user with handle ${clean}`);
  return data as Profile;
}

export async function syntheticProfiles(ctx: Ctx): Promise<Profile[]> {
  const { data, error } = await ctx.admin.schema("accounts").from("profiles").select("id,handle,status,is_synthetic,avatar_path,invited_by").eq("is_synthetic", true);
  if (error) throw new Error(`list synthetic users: ${error.message}`);
  return (data ?? []) as Profile[];
}

export interface CreatedUser {
  id: string;
  handle: string;
  email: string;
  password: string;
}

// Creates a confirmed synthetic user directly. This is the deliberate operator exception to invite-gated signup.
export async function createSyntheticUser(ctx: Ctx, invitedBy: string | null = null, inviteId: string | null = null): Promise<CreatedUser> {
  const handle = randomHandle();
  const email = `${handle}@rdv.invalid`;
  const password = randomPassword();
  const created = await ctx.admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create user: ${created.error?.message}`);
  const id = created.data.user.id;
  const profile = await ctx.admin.schema("accounts").rpc("create_profile", {
    p_id: id, p_handle: handle, p_invited_by: invitedBy, p_invite_id: inviteId, p_terms_version: "v1", p_synthetic: true,
  });
  if (profile.error) {
    await ctx.admin.auth.admin.deleteUser(id);
    throw new Error(`create profile: ${profile.error.message}`);
  }
  return { id, handle, email, password };
}

// The full deletion path from architecture.md: data, avatar files, then the auth user. The tombstone stays.
export async function deleteUserFully(ctx: Ctx, userId: string): Promise<void> {
  const avatar = check(await ctx.admin.schema("accounts").rpc("delete_account_data", { p_user: userId }), "delete data") as string | null;
  const listed = await ctx.admin.storage.from("avatars").list(userId);
  const paths = (listed.data ?? []).map((f) => `${userId}/${f.name}`);
  if (avatar && !paths.includes(avatar)) paths.push(avatar);
  if (paths.length) await ctx.admin.storage.from("avatars").remove(paths);
  const removed = await ctx.admin.auth.admin.deleteUser(userId);
  if (removed.error && !/not found/i.test(removed.error.message)) throw new Error(`delete auth user: ${removed.error.message}`);
}

export async function crewOwner(ctx: Ctx, crewId: string): Promise<{ id: string; name: string; owner_id: string; is_synthetic: boolean; status: string }> {
  const { data, error } = await ctx.admin.schema("crews").from("crews").select("id,name,owner_id,is_synthetic,status").eq("id", crewId).maybeSingle();
  if (error || !data) throw new Error(`No crew ${crewId}`);
  return data as never;
}

export async function profileById(ctx: Ctx, id: string): Promise<Profile> {
  const { data, error } = await ctx.admin.schema("accounts").from("profiles").select("id,handle,status,is_synthetic,avatar_path,invited_by").eq("id", id).maybeSingle();
  if (error || !data) throw new Error(`No user ${id}`);
  return data as Profile;
}

// Inserts a crew owned by a user, with its owner membership and link, using the service role.
export async function createSyntheticCrew(ctx: Ctx, ownerId: string, name: string): Promise<{ id: string; link_code: string }> {
  const code = randomCode(16);
  const crew = await ctx.admin.schema("crews").from("crews").insert({ name, owner_id: ownerId, link_code: code, is_synthetic: true }).select("id,link_code").single();
  if (crew.error) throw new Error(`create crew: ${crew.error.message}`);
  const member = await ctx.admin.schema("crews").from("members").insert({ crew_id: crew.data.id, user_id: ownerId, role: "owner" });
  if (member.error) throw new Error(`add owner: ${member.error.message}`);
  await ctx.admin.schema("crews").from("selections").insert({ user_id: ownerId, crew_id: crew.data.id });
  return crew.data as { id: string; link_code: string };
}

export async function addMember(ctx: Ctx, crewId: string, userId: string): Promise<void> {
  const res = await ctx.admin.schema("crews").from("members").upsert({ crew_id: crewId, user_id: userId, role: "member" }, { onConflict: "crew_id,user_id", ignoreDuplicates: true });
  if (res.error) throw new Error(`add member: ${res.error.message}`);
  await ctx.admin.schema("crews").from("selections").upsert({ user_id: userId, crew_id: crewId }, { onConflict: "user_id,crew_id", ignoreDuplicates: true });
}

export async function crewMembers(ctx: Ctx, crewId: string): Promise<Profile[]> {
  const { data, error } = await ctx.admin.schema("crews").from("members").select("user_id").eq("crew_id", crewId);
  if (error) throw new Error(`list members: ${error.message}`);
  const out: Profile[] = [];
  for (const row of data ?? []) out.push(await profileById(ctx, row.user_id as string));
  return out;
}

export { check };
