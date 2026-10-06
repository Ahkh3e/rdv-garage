export type ParsedLink =
  | { kind: "invite"; code: string }
  | { kind: "crew"; code: string }
  | { kind: "reset"; accessToken: string; refreshToken: string }
  | { kind: "confirmed" };

// Understands https://<link domain>/i/<code>, /c/<code>, /confirm, /reset#tokens and the rdvgarage:// scheme.
export function parseLink(url: string): ParsedLink | null {
  let path = "";
  let hash = "";
  try {
    const hashIndex = url.indexOf("#");
    hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : "";
    const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const withoutQuery = withoutHash.split("?")[0] ?? "";
    const schemeMatch = withoutQuery.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]*)(\/.*)?$/i);
    if (!schemeMatch) return null;
    const isCustomScheme = !/^https?:/i.test(withoutQuery);
    // For the custom scheme the first segment is the host (rdvgarage://invite/CODE or rdvgarage://i/CODE).
    path = isCustomScheme ? `/${schemeMatch[1] ?? ""}${schemeMatch[2] ?? ""}` : (schemeMatch[2] ?? "/");
  } catch {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  const [first, second] = segments;
  if ((first === "i" || first === "invite") && second) return { kind: "invite", code: second.toUpperCase() };
  if ((first === "c" || first === "crew") && second) return { kind: "crew", code: second.toUpperCase() };
  if (first === "confirm") return { kind: "confirmed" };
  if (first === "reset") {
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) return { kind: "reset", accessToken, refreshToken };
  }
  return null;
}
