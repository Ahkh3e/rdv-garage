import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, colors, radii, useStore, type Place } from "@rdv/core";
import { CATEGORIES, formatDistance } from "./categories";
import { useController } from "./context";

export function NearbyPanel({ onChoose, onClose }: { onChoose: (place: Place) => void; onClose: () => void }) {
  const controller = useController();
  const { nearby } = useStore(controller.state);
  return (
    <View testID="nearby-panel">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {CATEGORIES.map((category) => {
          const on = nearby?.category === category.id;
          return (
            <Pressable
              key={category.id}
              testID={`nearby-${category.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => void controller.showNearby(category.id)}
              style={[styles.chip, on && { backgroundColor: colors.accentSoft, borderColor: colors.accentBright }]}
            >
              <Text variant="caption" bold color={on ? colors.accentBright : colors.text}>{category.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {!nearby ? (
        <Text variant="caption" muted style={styles.pad}>Pick a category to see the closest places around the middle of the map.</Text>
      ) : nearby.hint === "zoom" ? (
        <Text variant="caption" muted style={styles.pad}>Zoom in a little to see places on the map.</Text>
      ) : nearby.results.length === 0 ? (
        <Text variant="caption" muted style={styles.pad}>Nothing found here. Move the map or zoom in.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
          {nearby.results.map((result, i) => (
            <Pressable
              key={`${result.place.lat}-${result.place.lng}-${i}`}
              testID={`nearby-result-${i}`}
              accessibilityRole="button"
              onPress={() => onChoose(result.place)}
              style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && { backgroundColor: colors.press }]}
            >
              <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>{result.place.name}</Text>
              <Text variant="caption" color={colors.muted}>{formatDistance(result.meters)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {nearby ? (
        <Pressable testID="nearby-clear" accessibilityRole="button" onPress={() => { controller.clearNearby(); onClose(); }} style={styles.pad}>
          <Text variant="caption" color={colors.muted}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { gap: 8, padding: 12 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center" },
  pad: { paddingHorizontal: 16, paddingBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 16 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
});
