export interface AppConfig {
  supabaseUrl: string;
  supabaseKey: string;
  linkDomain: string;
  flags: Record<string, boolean>;
  version: string;
  build: string;
}

export function inviteUrl(config: Pick<AppConfig, "linkDomain">, code: string): string {
  return `https://${config.linkDomain}/i/${code}`;
}

export function crewUrl(config: Pick<AppConfig, "linkDomain">, code: string): string {
  return `https://${config.linkDomain}/c/${code}`;
}
