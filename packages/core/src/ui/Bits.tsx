import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Switch as RNSwitch, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, radii } from "../theme";
import { DISCLAIMER_SHORT } from "../legal";
import { Text } from "./Text";

export function Spinner() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function Empty({ title, body, action, overline }: { title: string; body?: string; action?: ReactNode; overline?: string; icon?: string }) {
  return (
    <View style={styles.empty}>
      {overline ? <Text variant="label" color={colors.subtle}>{overline}</Text> : null}
      <Text variant="title">{title}</Text>
      {body ? <Text muted style={{ maxWidth: 300 }}>{body}</Text> : null}
      {action ? <View style={{ alignSelf: "stretch", marginTop: 16 }}>{action}</View> : null}
    </View>
  );
}

export function Banner({ text, tone = "info" }: { text: string; tone?: "info" | "error" }) {
  return (
    <View style={[styles.banner, tone === "error" && { borderColor: colors.danger }]}>
      <Text variant="body" color={tone === "error" ? colors.danger : colors.text}>{text}</Text>
    </View>
  );
}

export function Chip({ label, tint, selected }: { label: string; tint?: string; selected?: boolean }) {
  return (
    <View style={[styles.chip, selected && { backgroundColor: "rgba(255,255,255,0.12)", borderColor: colors.border }]}>
      {tint ? <View style={[styles.dot, { backgroundColor: tint }]} /> : null}
      <Text variant="caption" color={selected ? colors.text : colors.muted}>{label}</Text>
    </View>
  );
}

export function Toggle({ value, onChange, accessibilityLabel }: { value: boolean; onChange: (v: boolean) => void; accessibilityLabel?: string }) {
  return (
    <RNSwitch
      accessibilityLabel={accessibilityLabel}
      value={value}
      onValueChange={onChange}
      trackColor={{ false: "rgba(255,255,255,0.14)", true: colors.accent }}
      thumbColor="#F4F4F5"
      ios_backgroundColor="rgba(255,255,255,0.14)"
    />
  );
}

export function Disclaimer({ text = DISCLAIMER_SHORT }: { text?: string }) {
  return (
    <View style={styles.disclaimer}>
      <Feather name="info" size={16} color={colors.muted} style={{ marginTop: 2 }} />
      <Text variant="body" style={{ flex: 1, color: colors.text, opacity: 0.9, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "flex-start", gap: 8, paddingHorizontal: 4, paddingTop: 48 },
  banner: { padding: 14, borderRadius: radii.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.s1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: "rgba(255,255,255,0.05)" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  disclaimer: { flexDirection: "row", gap: 10, padding: 14, borderRadius: radii.md, borderCurve: "continuous", backgroundColor: colors.s1, borderWidth: 1, borderColor: colors.hairline },
});
