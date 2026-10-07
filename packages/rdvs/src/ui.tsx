import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text, colors, crewStyle, radii, useCrewState, useStore } from "@rdv/core";
import { useController } from "./context";
import { formatWhen } from "./format";
import { KIND_LABELS, isHappening, rowColorKey, type Rdv } from "./model";

export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useRdvs(): Rdv[] {
  return useStore(useController().state).rdvs;
}

export function LiveBadge() {
  return (
    <View style={styles.live}>
      <Text variant="caption" bold color={colors.onAccent}>LIVE</Text>
    </View>
  );
}

export function StatusBadge({ label }: { label: string }) {
  return (
    <View style={styles.status}>
      <Text variant="caption" bold color={colors.muted}>{label}</Text>
    </View>
  );
}

export function PickChip({ label, selected, onPress, tint, testID }: { label: string; selected: boolean; onPress: () => void; tint?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      {tint ? <View style={[styles.dot, { backgroundColor: tint }]} /> : null}
      <Text variant="caption" color={selected ? colors.text : colors.muted}>{label}</Text>
    </Pressable>
  );
}

export function RdvRow({ rdv, now, onPress, right }: { rdv: Rdv; now: number; onPress: () => void; right?: ReactNode }) {
  const { crews, selected } = useCrewState();
  const where = rdv.place ? rdv.place.name : rdv.areaName;
  return (
    <Pressable testID={`rdv-row-${rdv.id}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.press }]}>
      <View style={[styles.bar, { backgroundColor: crewStyle(rowColorKey(rdv, crews, selected)).tint }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.titleLine}>
          <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{rdv.title}</Text>
          {rdv.status === "cancelled" ? <StatusBadge label="CANCELLED" /> : isHappening(rdv, now) ? <LiveBadge /> : null}
        </View>
        <Text variant="body" muted numberOfLines={1} style={{ fontSize: 14, lineHeight: 20 }}>{formatWhen(rdv.startsAt, rdv.endsAt, now)}</Text>
        <Text variant="caption" muted numberOfLines={1}>{KIND_LABELS[rdv.kind]}  ·  {where}  ·  {rdv.going} going</Text>
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  live: { paddingHorizontal: 6, height: 18, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  status: { paddingHorizontal: 6, height: 18, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.fill },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentBright },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  bar: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
});
