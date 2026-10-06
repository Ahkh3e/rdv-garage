import { memo } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Text, colors, crewStyle, fonts, useAvatarUrl } from "@rdv/core";

interface Props {
  handle: string;
  avatarPath: string | null;
  styleIndex: number;
  stale: boolean;
}

const SIZE = 44;

function shapeStyle(index: number) {
  switch (crewStyle(index).shape) {
    case "square":
      return { borderRadius: 8 };
    case "diamond":
      return { borderRadius: 6, transform: [{ rotate: "45deg" }] };
    case "hexagon":
      return { borderRadius: 16 };
    case "triangle":
      return { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 };
    case "pill":
      return { borderRadius: 22, width: SIZE + 14 };
    default:
      return { borderRadius: SIZE / 2 };
  }
}

// A crew member on the map: their photo in a ring and shape that tell their crew apart, with the handle underneath.
function MemberMarkerBase({ handle, avatarPath, styleIndex, stale }: Props) {
  const url = useAvatarUrl(avatarPath);
  const tint = crewStyle(styleIndex).tint;
  const diamond = crewStyle(styleIndex).shape === "diamond";
  return (
    <View style={[styles.wrap, { opacity: stale ? 0.45 : 1 }]}>
      <View style={[styles.ring, { borderColor: tint }, shapeStyle(styleIndex)]}>
        <View style={diamond ? { transform: [{ rotate: "-45deg" }] } : undefined}>
          {url ? (
            <Image source={{ uri: url }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.initial]}>
              <Text bold muted>{handle.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.label}>
        <Text variant="caption" bold numberOfLines={1} style={{ fontFamily: fonts.semibold }}>{handle}</Text>
      </View>
    </View>
  );
}

export const MemberMarker = memo(MemberMarkerBase);

// The person's own position: an accent arrow, the one accent colour on the map. It points up while the map follows them.
export function SelfMarker({ following }: { following: boolean }) {
  return (
    <View style={styles.selfWrap}>
      <View style={styles.selfGlow} />
      {following ? <View style={styles.arrow} /> : <View style={styles.dot} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", minWidth: 70 },
  ring: { width: SIZE, height: SIZE, borderWidth: 3, alignItems: "center", justifyContent: "center", backgroundColor: colors.raised, overflow: "hidden" },
  photo: { width: SIZE - 8, height: SIZE - 8, borderRadius: (SIZE - 8) / 2 },
  initial: { alignItems: "center", justifyContent: "center", backgroundColor: colors.raised },
  label: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: "rgba(10,10,11,0.85)", maxWidth: 110 },
  selfWrap: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  selfGlow: { position: "absolute", width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, opacity: 0.22 },
  arrow: {
    width: 0, height: 0, borderLeftWidth: 13, borderRightWidth: 13, borderBottomWidth: 30,
    borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: colors.accent,
  },
  dot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent, borderWidth: 3, borderColor: "#fff" },
});
