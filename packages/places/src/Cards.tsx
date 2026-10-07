import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { DISCLAIMER_PLACES, Text, colors, messageFor, radii, crewStyle, useCrewState, useDistanceLabel, type Place } from "@rdv/core";
import { useController } from "./context";
import { expiresIn, placeOfPin, type Pin } from "./pins";

function Action({ title, onPress, testID, primary, danger }: { title: string; onPress: () => void; testID: string; primary?: boolean; danger?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, primary && { backgroundColor: colors.accent, borderColor: colors.accent }, pressed && { opacity: 0.8 }]}
    >
      <Text variant="caption" bold color={primary ? colors.onAccent : danger ? colors.danger : colors.text}>{title}</Text>
    </Pressable>
  );
}

function CardShell({ title, subtitle, children, onClose, tint, testID }: { title: string; subtitle?: string | null; children: React.ReactNode; onClose: () => void; tint?: string; testID: string }) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        {tint ? <Feather name="map-pin" size={18} color={tint} style={{ marginTop: 2 }} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline" numberOfLines={2}>{title}</Text>
          {subtitle ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
        <Pressable testID={`${testID}-close`} accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}>
          <Feather name="x" size={18} color={colors.muted} />
        </Pressable>
      </View>
      {children}
      <Text variant="caption" color={colors.subtle} style={{ fontSize: 11, lineHeight: 15 }}>{DISCLAIMER_PLACES}</Text>
    </View>
  );
}

function useActions() {
  const controller = useController();
  const [error, setError] = useState<string | null>(null);
  const run = (task: () => Promise<unknown>) => {
    setError(null);
    task().catch((e) => setError(messageFor(e)));
  };
  return { controller, error, run };
}

export function PlaceCard({ place }: { place: Place }) {
  const { controller, error, run } = useActions();
  const away = useDistanceLabel(place);
  return (
    <CardShell testID="place-card" title={place.name} subtitle={[place.kind, away ? `${away} away` : null, place.address].filter(Boolean).join("  ·  ")} onClose={controller.clearSelection}>
      <View style={styles.actions}>
        <Action testID="place-card-directions" title="Directions" primary onPress={() => run(() => controller.directions(place))} />
        <Action testID="place-card-drop" title="Drop pin" onPress={() => controller.startDrop(place)} />
        {controller.canMakeRdv() ? <Action testID="place-card-rdv" title="Make an RDV" onPress={() => controller.makeRdv(place)} /> : null}
      </View>
      {error ? <Text variant="caption" color={colors.danger}>{error}</Text> : null}
    </CardShell>
  );
}

export function PinCard({ pin, now }: { pin: Pin; now: number }) {
  const { controller, error, run } = useActions();
  const crews = useCrewState().crews;
  const crew = crews.find((c) => pin.crewIds.includes(c.id));
  const place = placeOfPin(pin);
  const away = useDistanceLabel(pin);
  return (
    <CardShell
      testID="pin-card"
      title={pin.label}
      subtitle={[`@${pin.dropperHandle}`, away ? `${away} away` : null, expiresIn(pin, now), pin.address].filter(Boolean).join("  ·  ")}
      tint={crewStyle(crew?.styleIndex ?? 0).tint}
      onClose={controller.clearSelection}
    >
      {pin.note ? <Text variant="body" style={{ fontSize: 14, lineHeight: 20 }}>{pin.note}</Text> : null}
      <View style={styles.actions}>
        <Action testID="pin-card-directions" title="Directions" primary onPress={() => run(() => controller.directions(place))} />
        {controller.canMakeRdv() ? <Action testID="pin-card-rdv" title="Make an RDV" onPress={() => controller.makeRdv(place)} /> : null}
        {controller.canRemove(pin) ? <Action testID="pin-card-remove" title="Remove" danger onPress={() => run(() => controller.removePin(pin.id))} /> : null}
      </View>
      {error ? <Text variant="caption" color={colors.danger}>{error}</Text> : null}
    </CardShell>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: radii.xl, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { paddingHorizontal: 14, height: 34, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
});
