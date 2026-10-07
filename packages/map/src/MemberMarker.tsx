import { memo } from "react";
import { Image, StyleSheet, View } from "react-native";
import { PulseDot, Text, colors, crewStyle, useAvatarUrl } from "@rdv/core";

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
        <View style={[styles.tintDot, { backgroundColor: tint }]} />
        <Text variant="caption" numberOfLines={1} style={{ color: colors.text }}>{handle}</Text>
      </View>
    </View>
  );
}

export const MemberMarker = memo(MemberMarkerBase);

// The person's own position: the one accent mark on the map. A dot with a soft halo, or an arrow while the map follows them.
export function SelfMarker({ following }: { following: boolean }) {
  return (
    <View style={styles.selfWrap}>
      {following ? (
        <>
          <PulseDot size={1} halo={44} />
          <View style={styles.arrowWrap}>
            <View style={styles.arrow} />
          </View>
        </>
      ) : (
        <PulseDot size={14} halo={3} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", minWidth: 70 },
  ring: { width: SIZE, height: SIZE, borderWidth: 3, alignItems: "center", justifyContent: "center", backgroundColor: colors.raised, overflow: "hidden" },
  photo: { width: SIZE - 8, height: SIZE - 8, borderRadius: (SIZE - 8) / 2 },
  initial: { alignItems: "center", justifyContent: "center", backgroundColor: colors.raised },
  label: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: 120 },
  tintDot: { width: 6, height: 6, borderRadius: 3 },
  selfWrap: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  arrowWrap: { position: "absolute", alignItems: "center", justifyContent: "center", width: 56, height: 56 },
  arrow: {
    width: 0, height: 0, borderLeftWidth: 11, borderRightWidth: 11, borderBottomWidth: 26,
    borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: colors.accentBright,
  },
});
