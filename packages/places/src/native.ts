import * as SecureStore from "expo-secure-store";
import { createRecents } from "./recents";

export const recents = createRecents({
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
});
