import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii } from "../theme";
import { Glass } from "./Glass";
import { Text } from "./Text";

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Sheet({ visible, onClose, title, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <Glass kind="sheet" style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grabber} />
          {title ? <Text variant="title" style={{ marginBottom: 12 }}>{title}</Text> : null}
          {children}
        </Glass>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim },
  sheet: { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, padding: 20, gap: 12 },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.28)", marginBottom: 8 },
});
