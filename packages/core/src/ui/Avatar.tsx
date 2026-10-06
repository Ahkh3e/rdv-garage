import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { colors, fonts } from "../theme";
import { useShell } from "../shell";
import { Text } from "./Text";

const cache = new Map<string, { url: string | null; at: number }>();

export function useAvatarUrl(path: string | null | undefined): string | null {
  const shell = useShell();
  const [url, setUrl] = useState<string | null>(path ? (cache.get(path)?.url ?? null) : null);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < 45 * 60 * 1000) {
      setUrl(hit.url);
      return;
    }
    shell.backend.avatarUrl(path).then((signed) => {
      cache.set(path, { url: signed, at: Date.now() });
      if (alive) setUrl(signed);
    });
    return () => {
      alive = false;
    };
  }, [path, shell]);
  return url;
}

interface Props {
  handle: string;
  path?: string | null;
  size?: number;
  ring?: string;
}

export function Avatar({ handle, path, size = 40, ring }: Props) {
  const url = useAvatarUrl(path);
  const inner = ring ? size - 6 : size;
  return (
    <View style={[styles.outer, { width: size, height: size, borderRadius: size / 2, borderColor: ring ?? "transparent", borderWidth: ring ? 2 : 0 }]}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: inner, height: inner, borderRadius: inner / 2 }} />
      ) : (
        <View style={[styles.fallback, { width: inner, height: inner, borderRadius: inner / 2 }]}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: inner * 0.42 }} muted>{handle.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { alignItems: "center", justifyContent: "center", backgroundColor: colors.raised },
  fallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.raised },
});
