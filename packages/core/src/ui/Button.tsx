import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { colors, fonts, radii } from "../theme";
import { Text } from "./Text";

interface Props {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({ title, onPress, variant = "primary", loading, disabled, style, testID }: Props) {
  const off = disabled || loading;
  const bg = variant === "primary" ? colors.accent : variant === "danger" ? "transparent" : variant === "secondary" ? colors.raised : "transparent";
  const fg = variant === "primary" ? "#0A0A0B" : variant === "danger" ? colors.danger : colors.text;
  const border = variant === "danger" ? colors.danger : variant === "secondary" ? colors.border : "transparent";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [styles.base, { backgroundColor: bg, borderColor: border, opacity: off ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontFamily: fonts.semibold }}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 50, borderRadius: radii.md, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
});
