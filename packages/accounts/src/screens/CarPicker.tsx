import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { CAR_COLORS, CAR_COLOR_KEYS, CAR_ICONS, CAR_ICON_KEYS, CarIcon, Screen, Text, colors, radii, useAction, useShell, useSession } from "@rdv/core";

// Choose the racecar that represents you on the map. The choice is saved at once and shared with your crews.
export function CarPicker() {
  const shell = useShell();
  const session = useSession();
  const updateMe = (patch: { carIcon?: string; carColor?: string | null }) => {
    const now = shell.session.get();
    if (now.status !== "signedIn") return;
    shell.session.set({ ...now, profile: { ...now.profile, ...patch } });
    shell.crewContext.store.set((prev) => ({
      ...prev,
      crews: prev.crews.map((crew) => ({ ...crew, members: crew.members.map((m) => (m.userId === now.userId ? { ...m, ...patch } : m)) })),
    }));
  };
  const choose = useAction(async (key: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    await shell.backend.rpc("accounts", "update_profile", { p_car_icon: key });
    updateMe({ carIcon: key });
  });

  const chooseColor = useAction(async (key: string | null) => {
    Haptics.selectionAsync().catch(() => undefined);
    await shell.backend.rpc("accounts", "update_profile", key ? { p_car_color: key } : { p_clear_car_color: true });
    updateMe({ carColor: key });
  });

  if (session.status !== "signedIn") return null;
  const { profile } = session;

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Text variant="large">Pick a car</Text>
        <Text muted>This is you on the map. Your crews see it.</Text>
      </View>
      {choose.error || chooseColor.error ? <Text color={colors.danger}>{choose.error ?? chooseColor.error}</Text> : null}
      <View style={styles.grid}>
        {CAR_ICON_KEYS.map((key) => {
          const on = profile.carIcon === key;
          return (
            <Pressable
              key={key}
              testID={`car-${key}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={CAR_ICONS[key].name}
              onPress={() => (on ? undefined : choose.run(key))}
              style={({ pressed }) => [styles.tile, on && styles.tileOn, pressed && { backgroundColor: colors.press }]}
            >
              <CarIcon icon={key} size={64} color={on ? colors.text : colors.muted} />
              <Text variant="caption" color={on ? colors.text : colors.subtle}>{CAR_ICONS[key].name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 4 }}>
        <Text variant="headline">Colour</Text>
        <Text muted>Your car, its trail and halo. Crew colour uses the colour of your crew.</Text>
      </View>
      <View style={styles.swatches}>
        <Pressable
          testID="car-color-crew"
          accessibilityRole="button"
          accessibilityState={{ selected: !profile.carColor }}
          accessibilityLabel="Crew colour"
          onPress={() => (profile.carColor ? chooseColor.run(null) : undefined)}
          style={[styles.crewChip, !profile.carColor && styles.tileOn]}
        >
          <Text variant="caption" bold color={!profile.carColor ? colors.text : colors.muted}>Crew colour</Text>
        </Pressable>
        {CAR_COLOR_KEYS.map((key) => {
          const on = profile.carColor === key;
          return (
            <Pressable
              key={key}
              testID={`car-color-${key}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={CAR_COLORS[key].name}
              onPress={() => (on ? undefined : chooseColor.run(key))}
              style={[styles.swatchRing, on && { borderColor: CAR_COLORS[key].hex }]}
            >
              <View style={[styles.swatch, { backgroundColor: CAR_COLORS[key].hex }]} />
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "47.5%", alignItems: "center", gap: 10, paddingVertical: 20, borderRadius: radii.xl, borderCurve: "continuous", borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface },
  swatches: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  crewChip: { height: 44, paddingHorizontal: 16, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  swatchRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  tileOn: { borderColor: colors.accentBright, backgroundColor: colors.accentSoft },
});
