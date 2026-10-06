import { createStore } from "@rdv/core";

// An invite code carried in from a link, the clipboard, or the Play Store install referrer.
export const pendingInvite = createStore<string | null>(null);

export const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;

export function extractInviteCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const direct = trimmed.toUpperCase();
  if (CODE_PATTERN.test(direct)) return direct;
  const fromLink = trimmed.match(/\/i\/([A-Za-z0-9]{12})(?:[/?#]|$)/);
  if (fromLink?.[1] && CODE_PATTERN.test(fromLink[1].toUpperCase())) return fromLink[1].toUpperCase();
  const fromReferrer = trimmed.match(/(?:^|[&?])invite=([A-Za-z0-9]{12})/);
  if (fromReferrer?.[1] && CODE_PATTERN.test(fromReferrer[1].toUpperCase())) return fromReferrer[1].toUpperCase();
  return null;
}
