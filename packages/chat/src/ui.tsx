import { StyleSheet, View } from "react-native";
import { Text, colors } from "@rdv/core";
import { badgeLabel } from "./model";

export function UnreadBadge({ count, testID }: { count: number; testID?: string }) {
  if (count <= 0) return null;
  return (
    <View testID={testID} style={styles.badge}>
      <Text variant="caption" color={colors.onAccent} bold>{badgeLabel(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
});
