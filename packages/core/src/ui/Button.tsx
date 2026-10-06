import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, radii } from "../theme";
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
  const primary = variant === "primary";
  const fg = primary ? (off ? colors.disabled : colors.onAccent) : variant === "danger" ? colors.danger : variant === "ghost" ? colors.muted : colors.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      onPress={
        off
          ? undefined
          : () => {
              if (primary) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              onPress();
            }
      }
      style={({ pressed }) => [
        styles.base,
        primary && { backgroundColor: off ? colors.fill : pressed ? colors.accentPressed : colors.accent },
        variant === "secondary" && { backgroundColor: pressed ? colors.border : colors.fill, borderColor: colors.border, borderWidth: 1 },
        (variant === "ghost" || variant === "danger") && { backgroundColor: pressed ? colors.press : "transparent" },
        { transform: [{ scale: pressed && !off ? 0.98 : 1 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text variant="headline" style={{ color: fg }}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 52, borderRadius: radii.md, borderCurve: "continuous", alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
});
