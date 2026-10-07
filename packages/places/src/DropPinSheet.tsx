import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Banner, Button, DISCLAIMER_PLACES, Disclaimer, Input, Sheet, Text, colors, crewStyle, messageFor, radii, useCrewState, useStore } from "@rdv/core";
import { useController } from "./context";
import { LABEL_MAX, NOTE_MAX, labelError, noteError } from "./validation";

export function DropPinSheet() {
  const controller = useController();
  const { draft } = useStore(controller.state);
  const crews = useCrewState().crews.filter((crew) => crew.selected);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    setLabel(draft.label);
    setNote("");
    setChosen(crews.map((crew) => crew.id));
    setError(null);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const problem = labelError(label) ?? noteError(note) ?? (chosen.length === 0 ? "pin_crew_required" : null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await controller.drop({ label, note, crewIds: chosen });
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={!!draft} onClose={controller.cancelDrop} title="Drop pin">
      <Input testID="drop-label" label="Label" value={label} onChangeText={setLabel} maxLength={LABEL_MAX} autoCorrect={false} hint="3 to 40 characters" />
      <Input testID="drop-note" label="Note (optional)" value={note} onChangeText={setNote} maxLength={NOTE_MAX} multiline style={{ minHeight: 72, paddingTop: 14, textAlignVertical: "top" }} />
      <View style={{ gap: 8 }}>
        <Text variant="label" color={colors.subtle}>Visible to</Text>
        {crews.length === 0 ? (
          <Text variant="body" muted>Switch on a crew in Crews to drop a pin for it.</Text>
        ) : (
          <View style={styles.chips}>
            {crews.map((crew) => {
              const on = chosen.includes(crew.id);
              return (
                <Pressable
                  key={crew.id}
                  testID={`drop-crew-${crew.name}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setChosen((prev) => (on ? prev.filter((id) => id !== crew.id) : [...prev, crew.id]))}
                  style={[styles.chip, on && { backgroundColor: "rgba(255,255,255,0.12)", borderColor: colors.border }]}
                >
                  <View style={[styles.dot, { backgroundColor: crewStyle(crew.styleIndex).tint }]} />
                  <Text variant="caption" color={on ? colors.text : colors.muted}>{crew.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Text variant="caption" color={colors.subtle}>Lasts 24 hours. Only members of these crews see it.</Text>
      </View>
      <Disclaimer text={DISCLAIMER_PLACES} />
      {error ? <Banner tone="error" text={error} /> : null}
      <Button testID="drop-submit" title="Drop pin" loading={busy} disabled={!!problem} onPress={submit} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: "rgba(255,255,255,0.05)" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
