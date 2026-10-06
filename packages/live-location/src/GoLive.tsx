import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Chip, Disclaimer, Sheet, Text, colors, crewStyle, messageFor, radii, useCrewState, useLiveState, useShell } from "@rdv/core";
import type { LiveController } from "./controller";
import { openSettings } from "./permissions";

let controller: LiveController | null = null;
export const setController = (c: LiveController) => void (controller = c);

export function GoLiveControl() {
  const shell = useShell();
  const crewState = useCrewState();
  const live = useLiveState();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSettings, setNeedsSettings] = useState(false);

  useEffect(() => {
    if (open) setPicked(crewState.selected.length ? crewState.selected : crewState.crews.map((c) => c.id).slice(0, 1));
    setError(null);
    setNeedsSettings(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!controller) return null;

  const start = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await controller!.goLive(picked);
      if (result === "ok") setOpen(false);
      else {
        setNeedsSettings(true);
        setError(result === "denied" ? "Location access is off. Turn it on in Settings to go live." : "Going live needs location access all the time, so crew members still see you when the app is in the background.");
      }
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  if (live.live) {
    const names = crewState.crews.filter((c) => live.crewIds.includes(c.id)).map((c) => c.name);
    return (
      <View style={styles.dock} pointerEvents="box-none">
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <View style={{ flex: 1 }}>
            <Text bold>Live</Text>
            <Text variant="caption" muted numberOfLines={1}>Visible to {names.join(", ") || "your crews"}</Text>
          </View>
          <Button title="Stop" testID="golive-stop" variant="secondary" onPress={() => void controller!.stop()} style={{ minHeight: 40, paddingHorizontal: 16 }} />
        </View>
      </View>
    );
  }

  const noCrews = crewState.loaded && crewState.crews.length === 0;
  return (
    <View style={styles.dock} pointerEvents="box-none">
      <Pressable
        testID="golive-button"
        accessibilityRole="button"
        onPress={() => (noCrews ? shell.navigate("Tabs") : setOpen(true))}
        style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="radio" size={20} color="#0A0A0B" />
        <Text bold color="#0A0A0B">{noCrews ? "Join a crew to go live" : "Go live"}</Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Go live">
        <Text muted>Pick who can see you. They see your position and your top speed after the session. Stop any time.</Text>
        <View style={{ gap: 10 }}>
          {crewState.crews.map((crew) => {
            const on = picked.includes(crew.id);
            const style = crewStyle(crew.styleIndex);
            return (
              <Pressable
                key={crew.id}
                testID={`golive-crew-${crew.name}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setPicked(on ? picked.filter((id) => id !== crew.id) : [...picked, crew.id])}
                style={[styles.crewRow, on && { borderColor: style.tint }]}
              >
                <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.accent : colors.muted} />
                <Text style={{ flex: 1 }}>{crew.name}</Text>
                <Chip label={`${crew.members.length}`} tint={style.tint} />
              </Pressable>
            );
          })}
        </View>
        <Disclaimer />
        {error ? <Text color={colors.danger}>{error}</Text> : null}
        {needsSettings ? <Button title="Open settings" variant="secondary" onPress={openSettings} /> : null}
        <Button title="Start" testID="golive-start" loading={busy} disabled={picked.length === 0} onPress={start} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 16, right: 16, bottom: 20, alignItems: "center" },
  cta: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.accent, paddingHorizontal: 28, minHeight: 56, borderRadius: radii.pill, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.accent, padding: 12 },
  liveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
  crewRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised },
});
