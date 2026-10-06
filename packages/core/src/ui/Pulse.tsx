import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "../theme";

// A dot with a soft halo that breathes. The halo stays still when Reduce Motion is on.
export function PulseDot({ size = 8, halo = 2.6, color = colors.accent }: { size?: number; halo?: number; color?: string }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((reduce) => {
        if (!alive || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(t, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(t, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        );
        loop.start();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      loop?.stop();
    };
  }, [t]);
  const box = size * halo;
  return (
    <View style={{ width: box, height: box, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: box / 2, backgroundColor: color, opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.14, 0.28] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] },
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}
