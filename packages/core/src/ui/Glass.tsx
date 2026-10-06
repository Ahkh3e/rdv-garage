import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { colors, glass } from "../theme";

function useSolid() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then((on) => alive && setSolid(on))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return solid;
}

interface GlassProps {
  kind?: keyof Pick<typeof glass, "sheet" | "control" | "bar">;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

// A floating layer: blurred, tinted, with a hairline edge. Use it for controls, bars and sheets, never inside content.
export function Glass({ kind = "control", style, children }: GlassProps) {
  const solid = useSolid();
  const spec = glass[kind];
  return (
    <View style={[styles.base, style]}>
      {solid ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.solid }]} />
      ) : (
        <>
          <BlurView intensity={spec.intensity} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: spec.overlay }]} />
        </>
      )}
      {children}
    </View>
  );
}

interface GlassButtonProps {
  children: ReactNode;
  onPress: () => void;
  label: string;
  testID?: string;
  size?: number;
}

export function GlassButton({ children, onPress, label, testID, size = 44 }: GlassButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, transform: [{ scale: pressed ? 0.96 : 1 }] }, styles.shadow]}
    >
      <Glass kind="control" style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" }}>
        {children}
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderCurve: "continuous" },
  shadow: { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
});
