import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radii } from "../theme";
import { Text } from "./Text";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

interface RowProps {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  testID?: string;
}

export function Row({ title, subtitle, left, right, onPress, danger, testID }: RowProps) {
  const content = (
    <View style={styles.row}>
      {left}
      <View style={{ flex: 1 }}>
        <Text variant="headline" color={danger ? colors.danger : undefined}>{title}</Text>
        {subtitle ? <Text variant="body" muted style={{ fontSize: 14, lineHeight: 20 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  return onPress ? (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ backgroundColor: pressed ? colors.press : "transparent" }]}>
      {content}
    </Pressable>
  ) : (
    content
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: 16 }} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, borderCurve: "continuous", borderWidth: 1, borderColor: colors.hairline, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 64, paddingVertical: 10 },
});
