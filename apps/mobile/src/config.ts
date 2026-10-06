import type { AppConfig } from "@rdv/core";

function readFlags(): Record<string, boolean> {
  try {
    return JSON.parse(process.env.EXPO_PUBLIC_FLAGS ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

// Public values only. The Supabase publishable key is safe to ship; the service key never goes in the app.
export const config: AppConfig = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_KEY ?? "",
  linkDomain: process.env.EXPO_PUBLIC_LINK_DOMAIN ?? "links.rdvgarage.example",
  flags: readFlags(),
};
