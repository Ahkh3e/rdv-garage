import type { CrewRole, CrewSummary, Shell } from "@rdv/core";

interface CrewRow {
  id: string;
  name: string;
  description: string | null;
  avatar_path: string | null;
  owner_id: string;
  role: CrewRole;
  link_code: string | null;
  selected: boolean;
  members: { user_id: string; handle: string; avatar_path: string | null; car_icon?: string; car_color?: string | null; role: CrewRole; live: boolean; voice_off?: boolean }[];
}

export async function loadCrews(shell: Shell): Promise<void> {
  const rows = await shell.backend.rpc<CrewRow[]>("crews", "list_my_crews");
  const crews: Omit<CrewSummary, "styleIndex">[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    avatarPath: row.avatar_path,
    ownerId: row.owner_id,
    role: row.role,
    linkCode: row.link_code,
    selected: row.selected,
    members: (row.members ?? []).map((m) => ({ userId: m.user_id, handle: m.handle, avatarPath: m.avatar_path, carIcon: m.car_icon ?? "gt", carColor: m.car_color ?? null, role: m.role, live: m.live, voiceOff: m.voice_off === true })),
  }));
  shell.crewContext.setCrews(crews);
}
