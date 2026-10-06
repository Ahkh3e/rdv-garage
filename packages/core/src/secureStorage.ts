// Supabase sessions are larger than the roughly 2 KB limit on a single secure store value on some iOS versions,
// so values are split into chunks. The store itself is injected so this stays testable.
export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const CHUNK = 1800;

export function createChunkedStorage(store: KeyValueStore) {
  return {
    async getItem(key: string): Promise<string | null> {
      const countRaw = await store.getItemAsync(`${key}.count`);
      if (countRaw === null) return null;
      const count = Number(countRaw);
      let out = "";
      for (let i = 0; i < count; i++) {
        const part = await store.getItemAsync(`${key}.${i}`);
        if (part === null) return null;
        out += part;
      }
      return out;
    },
    async setItem(key: string, value: string): Promise<void> {
      await this.removeItem(key);
      const count = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < count; i++) await store.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
      await store.setItemAsync(`${key}.count`, String(count));
    },
    async removeItem(key: string): Promise<void> {
      const countRaw = await store.getItemAsync(`${key}.count`);
      if (countRaw !== null) {
        for (let i = 0; i < Number(countRaw); i++) await store.deleteItemAsync(`${key}.${i}`);
        await store.deleteItemAsync(`${key}.count`);
      }
    },
  };
}
