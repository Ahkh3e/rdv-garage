import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useContext } from "react";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";

interface Props {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  topInset?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
  footer?: ReactNode;
  // Keep content clear of the home indicator while the keyboard is down, for screens that end in a composer.
  bottomInset?: boolean;
}

export function Screen({ children, scroll = true, padded = true, topInset = true, refreshing, onRefresh, style, footer, bottomInset = false }: Props) {
  const insets = useSafeAreaInsets();
  const root = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const tabBar = useContext(BottomTabBarHeightContext) ?? 0;
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[padded && styles.padded, { flexGrow: 1, paddingBottom: (padded ? 20 : 0) + tabBar }, style]}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.muted} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && styles.padded, style]}>{children}</View>
  );
  return (
    <View
      ref={root}
      style={{ flex: 1 }}
      // The keyboard's height is measured against the window, so a screen below a navigation header needs that header's height as an offset.
      onLayout={() => root.current?.measureInWindow((_x, y) => setOffset((prev) => (Math.abs(prev - y) > 0.5 ? y : prev)))}
    >
      <KeyboardAvoidingView
        keyboardVerticalOffset={offset}
        style={[styles.root, { paddingTop: topInset ? insets.top : 0, paddingBottom: bottomInset && !keyboard ? insets.bottom : 0 }]}
        behavior="padding"
      >
        {body}
        {footer}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  padded: { padding: 20, gap: 16 },
});
