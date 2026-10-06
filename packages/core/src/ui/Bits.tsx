import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Switch as RNSwitch, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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

export function Empty({ title, body, action, icon = "ellipse-outline" }: { title: string; body?: string; action?: ReactNode; icon?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon as any} size={28} color={colors.muted} />
      <Text variant="title" style={{ textAlign: "center" }}>{title}</Text>
      {body ? <Text muted style={{ textAlign: "center" }}>{body}</Text> : null}
      {action}
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
    <View style={[styles.chip, selected && { backgroundColor: colors.raised, borderColor: tint ?? colors.accent }]}>
      {tint ? <View style={[styles.dot, { backgroundColor: tint }]} /> : null}
      <Text variant="caption">{label}</Text>
    </View>
  );
}

export function Toggle({ value, onChange, accessibilityLabel }: { value: boolean; onChange: (v: boolean) => void; accessibilityLabel?: string }) {
  return (
    <RNSwitch
      accessibilityLabel={accessibilityLabel}
      value={value}
      onValueChange={onChange}
      trackColor={{ false: colors.border, true: colors.accent }}
      thumbColor="#F4F4F5"
      ios_backgroundColor={colors.border}
    />
  );
}

export function Disclaimer({ text = DISCLAIMER_SHORT }: { text?: string }) {
  return (
    <View style={styles.disclaimer}>
      <Ionicons name="alert-circle-outline" size={16} color={colors.muted} style={{ marginTop: 2 }} />
      <Text variant="caption" style={{ flex: 1, color: colors.text, opacity: 0.85 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: 10, padding: 32 },
  banner: { padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  disclaimer: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
