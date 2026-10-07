import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { CAR_ICONS, CAR_ICON_KEYS, CarIcon, Screen, Text, colors, radii, useAction, useShell, useSession } from "@rdv/core";

// Choose the racecar that represents you on the map. The choice is saved at once and shared with your crews.
export function CarPicker() {
  const shell = useShell();
  const session = useSession();
  const choose = useAction(async (key: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    await shell.backend.rpc("accounts", "update_profile", { p_car_icon: key });
    // Read the session after the request: it may have changed while the request was in flight.
    const now = shell.session.get();
    if (now.status === "signedIn") shell.session.set({ ...now, profile: { ...now.profile, carIcon: key } });
  });

  if (session.status !== "signedIn") return null;
  const { profile } = session;

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Text variant="large">Pick a car</Text>
        <Text muted>This is you on the map. Your crews see it.</Text>
      </View>
      {choose.error ? <Text color={colors.danger}>{choose.error}</Text> : null}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "47.5%", alignItems: "center", gap: 10, paddingVertical: 20, borderRadius: radii.xl, borderCurve: "continuous", borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface },
  tileOn: { borderColor: colors.accentBright, backgroundColor: colors.accentSoft },
});
