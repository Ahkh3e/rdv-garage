import * as SecureStore from "expo-secure-store";

const KEY = "rdv.reset.requested";
const WINDOW_MS = 60 * 60 * 1000;

// A reset link carries session tokens. Only accept one if this phone asked for a reset a short while ago,
// so a link crafted by someone else cannot sign the person into the wrong account.
export async function markResetRequested(now = Date.now()): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, String(now));
  } catch {
    // Without secure storage the link simply is not accepted.
  }
}

export async function consumeResetIntent(now = Date.now()): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return false;
    await SecureStore.deleteItemAsync(KEY);
    return now - Number(raw) < WINDOW_MS;
  } catch {
    return false;
  }
}
