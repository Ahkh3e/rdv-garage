import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Button, Chip, Disclaimer, Glass, PulseDot, Sheet, Text, Toggle, colors, crewStyle, messageFor, radii, useCrewState, useLiveState, useShell, useStore } from "@rdv/core";
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
  const [shareSpeed, setShareSpeed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSettings, setNeedsSettings] = useState(false);

  const request = useStore(shell.goLiveRequest);
  const preset = useRef(false);

  useEffect(() => {
    if (!request) return;
    shell.goLiveRequest.set(null);
    if (!controller || live.live) return;
    const mine = request.crewIds.filter((id) => crewState.crews.some((c) => c.id === id));
    if (mine.length === 0) return;
    preset.current = !open;
    setPicked(mine);
    setOpen(true);
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      if (preset.current) preset.current = false;
      else setPicked(crewState.selected.length ? crewState.selected : crewState.crews.map((c) => c.id).slice(0, 1));
    }
    setError(null);
    setNeedsSettings(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!controller) return null;

  const start = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await controller!.goLive(picked, { shareSpeed });
      if (result === "ok") {
        setOpen(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
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
        <Glass kind="control" style={styles.livePill}>
          <PulseDot />
          <View style={{ flex: 1 }}>
            <Text variant="headline">Live</Text>
            <Text variant="caption" muted numberOfLines={1}>Visible to {names.join(", ") || "your crews"}</Text>
          </View>
          <Button title="Stop" testID="golive-stop" variant="ghost" onPress={() => void controller!.stop()} style={{ minHeight: 40, paddingHorizontal: 16 }} />
        </Glass>
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
        style={({ pressed }) => [styles.cta, pressed && { backgroundColor: colors.accentPressed, transform: [{ scale: 0.98 }] }]}
      >
        <Feather name="radio" size={18} color={colors.onAccent} />
        <Text variant="headline" color={colors.onAccent}>{noCrews ? "Join a crew to go live" : "Go live"}</Text>
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
                style={styles.crewRow}
              >
                <View style={[styles.box, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
                  {on ? <Feather name="check" size={15} color={colors.onAccent} /> : null}
                </View>
                <Text variant="headline" style={{ flex: 1 }}>{crew.name}</Text>
                <Chip label={`${crew.members.length}`} tint={style.tint} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.speedRow}>
          <View style={{ flex: 1 }}>
            <Text variant="headline">Show my speed to the crew</Text>
            <Text variant="caption" muted>Members you picked see your speed in the crew list while you are live.</Text>
          </View>
          <Toggle accessibilityLabel="Show my speed to the crew" value={shareSpeed} onChange={setShareSpeed} />
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
  dock: { position: "absolute", left: 16, right: 16, bottom: 12, alignItems: "center" },
  cta: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.accent, paddingHorizontal: 28, minHeight: 56, minWidth: 168, justifyContent: "center", borderRadius: radii.pill, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "stretch", borderRadius: radii.md, paddingVertical: 10, paddingLeft: 12, paddingRight: 8 },
  crewRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56, paddingHorizontal: 14, borderRadius: radii.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.fill },
  speedRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.fill },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
});
