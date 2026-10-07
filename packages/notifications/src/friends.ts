// Who has just gone live. A member counts as newly live when they were not on the map a moment ago, so a driver who is
// simply moving never re-notifies, and a driver who stops and goes live again later does.
export const REUSE_AFTER_MS = 10 * 60 * 1000;

export interface LiveMember {
  userId: string;
  crewIds: string[];
}

export function newlyLive(
  members: LiveMember[],
  seen: Map<string, number>,
  notified: Map<string, number>,
  now: number,
  selfId: string | null,
): LiveMember[] {
  const fresh: LiveMember[] = [];
  const present = new Set(members.map((m) => m.userId));
  for (const m of members) {
    if (m.userId === selfId) continue;
    if (!seen.has(m.userId)) {
      const last = notified.get(m.userId);
      if (last === undefined || now - last > REUSE_AFTER_MS) fresh.push(m);
    }
  }
  for (const id of [...seen.keys()]) if (!present.has(id)) seen.delete(id);
  for (const m of members) seen.set(m.userId, now);
  return fresh;
}
