import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { CarIcon, PulseDot, Text, colors, crewStyle } from "@rdv/core";

interface Props {
  handle: string;
  carIcon: string;
  styleIndex: number;
  stale: boolean;
  // Degrees the car points on screen: its heading minus the map's bearing.
  rotation: number;
}

const BADGE = 46;

// A crew member on the map: their chosen racecar seen from above on a dark badge, ringed in the crew tint, with their handle below.
function MemberMarkerBase({ handle, carIcon, styleIndex, stale, rotation }: Props) {
  const tint = crewStyle(styleIndex).tint;
  return (
    <View style={[styles.wrap, { opacity: stale ? 0.45 : 1 }]}>
      <View style={[styles.badge, { borderColor: tint }]}>
        <CarIcon icon={carIcon} size={30} rotation={rotation} />
      </View>
      <View style={styles.label}>
        <View style={[styles.tintDot, { backgroundColor: tint }]} />
        <Text variant="caption" numberOfLines={1} style={{ color: colors.text }}>{handle}</Text>
      </View>
    </View>
  );
}

export const MemberMarker = memo(MemberMarkerBase);

// The person's own position: their own car on a badge with the bright blue ring and a soft pulsing halo.
export function SelfMarker({ carIcon, rotation }: { carIcon: string; rotation: number }) {
  return (
    <View style={styles.selfWrap}>
      <PulseDot size={1} halo={64} />
      <View style={[styles.badge, styles.selfBadge]}>
        <CarIcon icon={carIcon} size={30} rotation={rotation} color={colors.text} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", minWidth: 70 },
  badge: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, borderWidth: 2.5, alignItems: "center", justifyContent: "center", backgroundColor: colors.s1 },
  selfBadge: { borderColor: colors.accentBright },
  label: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: 120 },
  tintDot: { width: 6, height: 6, borderRadius: 3 },
  selfWrap: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
});
