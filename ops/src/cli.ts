import { Command } from "commander";
import { runCommand } from "./context";
import { crewAdd, crewCreate, crewDelete, crewRemove } from "./commands/crews";
import { purgeSynthetic, status } from "./commands/misc";
import { simInvites, simLeaderboard, simLive } from "./commands/sim";
import { inviteDisable, inviteList, userCreate, userDelete, userRestore, userShow, userSuspend } from "./commands/users";
import type { RouteStyle } from "./routes";

const program = new Command("rdv-ops")
  .description("RDV Garage operator toolkit. Runs on the operator server. See ops/README.md.")
  .option("--production", "allow this command in a production environment")
  .option("--confirm-project <name>", "type the project name for production commands without a terminal")
  .option("--dry-run", "print what would change and change nothing");

const g = () => program.opts<{ production?: boolean; confirmProject?: string; dryRun?: boolean }>();
const run = async (name: string, args: Record<string, unknown>, body: Parameters<typeof runCommand<unknown>>[3]): Promise<void> => {
  await runCommand(name, args, g(), body);
};
const int = (v: string) => Number.parseInt(v, 10);

const user = program.command("user");
user.command("create").option("--count <n>", "how many", int, 1).option("--invited-by <handle>").option("--credentials-file <path>")
  .action((o) => run("user create", o, (ctx) => userCreate(ctx, { count: o.count, invitedBy: o.invitedBy, credentialsFile: o.credentialsFile })));
user.command("delete [handle]").option("--synthetic", "delete every synthetic user")
  .action((handle, o) => run("user delete", { handle, ...o }, (ctx) => userDelete(ctx, { handle, synthetic: o.synthetic })));
user.command("suspend <handle>").action((handle) => run("user suspend", { handle }, (ctx) => userSuspend(ctx, handle)));
user.command("restore <handle>").action((handle) => run("user restore", { handle }, (ctx) => userRestore(ctx, handle)));
user.command("show <handle>").action((handle) => run("user show", { handle }, (ctx) => userShow(ctx, handle)));

const invite = program.command("invite");
invite.command("list <handle>").action((handle) => run("invite list", { handle }, (ctx) => inviteList(ctx, handle)));
invite.command("disable <id>").action((id) => run("invite disable", { id }, (ctx) => inviteDisable(ctx, id)));

const crew = program.command("crew");
crew.command("create").option("--owner <handle>").option("--members <n>", "extra synthetic members", int, 3).option("--name <name>")
  .action((o) => run("crew create", o, (ctx) => crewCreate(ctx, { owner: o.owner, members: o.members, name: o.name })));
crew.command("delete <id>").option("--confirm-name <name>", "required to delete a real crew")
  .action((id, o) => run("crew delete", { id, ...o }, (ctx) => crewDelete(ctx, { id, confirmName: o.confirmName })));
crew.command("add <id> <handle>").action((id, handle) => run("crew add", { id, handle }, (ctx) => crewAdd(ctx, { id, handle })));
crew.command("remove <id> <handle>").action((id, handle) => run("crew remove", { id, handle }, (ctx) => crewRemove(ctx, { id, handle })));

const sim = program.command("sim");
sim.command("live").option("--crew <id>").option("--users <n>", "synthetic drivers", int, 4).option("--duration <seconds>", "how long to drive", int, 120)
  .option("--route <style>", "city or highway", "city").option("--stale <n>", "drivers that go silent without stopping", int, 0)
  .action((o) => run("sim live", o, (ctx) => simLive(ctx, { crewId: o.crew, users: o.users, durationSec: o.duration, route: o.route as RouteStyle, staleUsers: o.stale })));
sim.command("leaderboard").requiredOption("--crew <id>").option("--previous-week")
  .action((o) => run("sim leaderboard", o, (ctx) => simLeaderboard(ctx, { crewId: o.crew, previousWeek: o.previousWeek })));
sim.command("invites").option("--count <n>", "how many joins", int, 5).option("--depth <n>", "chain depth", int, 1).option("--inviter <handle>")
  .action((o) => run("sim invites", o, (ctx) => simInvites(ctx, { count: o.count, depth: o.depth, inviter: o.inviter })));

program.command("purge-synthetic").description("delete every synthetic user, crew, session, and segment")
  .action(() => run("purge-synthetic", {}, (ctx) => purgeSynthetic(ctx)));
program.command("status").action(() => run("status", {}, (ctx) => status(ctx)));

program.parseAsync(process.argv).catch((error) => {
  console.error(`error: ${(error as Error).message}`);
  process.exit(1);
});
