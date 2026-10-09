import { useContext, useEffect, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { HeaderHeightContext } from "@react-navigation/elements";
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
  bottomInset?: boolean;
}

export function Screen({ children, scroll = true, padded = true, topInset = true, refreshing, onRefresh, style, footer, bottomInset = false }: Props) {
  const insets = useSafeAreaInsets();
  const header = useContext(HeaderHeightContext) ?? 0;
  const tabBar = useContext(BottomTabBarHeightContext) ?? 0;
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    if (!bottomInset) return;
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [bottomInset]);
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
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: topInset ? insets.top : 0 }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={header}
    >
      <View style={{ flex: 1, paddingBottom: bottomInset && !keyboard ? insets.bottom : 0 }}>
        {body}
        {footer}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  padded: { padding: 20, gap: 16 },
});
