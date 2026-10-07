import { File, Paths } from "expo-file-system";
import { createRecents } from "./recents";

// Recent searches live in the app's own files, which are removed on uninstall (Keychain items are not).
const file = () => new File(Paths.document, "rdv-places-recents.json");

export const recents = createRecents({
  async get() {
    const f = file();
    return f.exists ? f.text() : null;
  },
  async set(_key, value) {
    const f = file();
    if (!f.exists) f.create();
    f.write(value);
  },
});
