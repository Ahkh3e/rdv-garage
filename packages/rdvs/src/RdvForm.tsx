import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Banner, Button, Disclaimer, DISCLAIMER_PLACES, Input, Screen, Text, colors, crewStyle, messageFor, radii, useAction, useCrewState, useShell, type Place } from "@rdv/core";
import { AppError } from "@rdv/core/errors";
import { useController } from "./context";
import { DETAIL_ROUTE } from "./controller";
import { RADIUS_STEP, dayOptions, draftError, draftFromRdv, emptyDraft, endOf, startOfDay, stepDuration, stepRadius, withDay, withTimeShift, STEP_MIN, type Draft } from "./draft";
import { formatDay, formatDuration, formatTime } from "./format";
import { DEFAULT_DURATION_MS, KIND_LABELS, NOTE_MAX, TITLE_MAX, type RdvKind } from "./model";
import { PickChip } from "./ui";

const KINDS: RdvKind[] = ["meet", "cruise", "private_event"];

function Stepper({ label, value, onMinus, onPlus, testID }: { label: string; value: string; onMinus: () => void; onPlus: () => void; testID: string }) {
  return (
    <View style={styles.stepper}>
      <Text variant="label" color={colors.subtle}>{label}</Text>
      <View style={styles.stepRow}>
        <Pressable testID={`${testID}-minus`} accessibilityRole="button" accessibilityLabel={`${label} less`} onPress={onMinus} style={styles.stepButton}>
          <Text variant="headline">-</Text>
        </Pressable>
        <Text variant="headline" testID={`${testID}-value`} style={{ flex: 1, textAlign: "center" }}>{value}</Text>
        <Pressable testID={`${testID}-plus`} accessibilityRole="button" accessibilityLabel={`${label} more`} onPress={onPlus} style={styles.stepButton}>
          <Text variant="headline">+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function RdvForm({ navigation, route }: { navigation: any; route: { params?: { place?: Place; id?: string } } }) {
  const shell = useShell();
  const controller = useController();
  const crewState = useCrewState();
  const editing = route.params?.id ? controller.find(route.params.id) : null;
  const now = useMemo(() => Date.now(), []);
  const [draft, setDraft] = useState<Draft>(() => {
    if (editing) return draftFromRdv(editing);
    const selected = crewState.selected.filter((id) => crewState.crews.some((c) => c.id === id));
    const crewIds = selected.length ? selected : crewState.crews.slice(0, 1).map((c) => c.id);
    return emptyDraft(route.params?.place ?? null, crewIds, now);
  });
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const error = draftError(draft, Date.now(), editing?.startsAt ?? null);
  const save = useAction(async () => {
    if (error) {
      setTouched(true);
      return;
    }
    if (editing) {
      await controller.update(editing.id, draft);
      navigation.goBack();
    } else {
      const id = await controller.create(draft);
      navigation.replace(DETAIL_ROUTE, { id });
    }
  });

  const pickPlace = async () => {
    const place = await shell.places.pick();
    if (place) set({ place, areaName: null });
  };

  const days = dayOptions(now);
  const start = draft.startsAt ?? now;
  const end = endOf(draft);
  const toggleCrew = (id: string) => set({ crewIds: draft.crewIds.includes(id) ? draft.crewIds.filter((c) => c !== id) : [...draft.crewIds, id] });

  if (crewState.crews.length === 0) {
    return (
      <Screen>
        <Text variant="title">Join a crew first</Text>
        <Text muted>An RDV is for your crews. Create or join one from the Crews tab.</Text>
        <Button title="Back" variant="secondary" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="large">{editing ? "Edit RDV" : "New RDV"}</Text>
      <Input testID="rdv-title" label="Title" value={draft.title} onChangeText={(title) => set({ title })} maxLength={TITLE_MAX} placeholder="Sunday meet" />

      <Text variant="label" color={colors.subtle}>Kind</Text>
      <View style={styles.wrap}>
        {KINDS.map((kind) => (
          <PickChip key={kind} testID={`rdv-kind-${kind}`} label={KIND_LABELS[kind]} selected={draft.kind === kind} onPress={() => set(kind === "private_event" && draft.kind !== "private_event" ? { kind, areaName: null } : { kind })} />
        ))}
      </View>
      {draft.kind === "private_event" ? (
        <>
          <Text variant="caption" muted>The exact place stays hidden until a member answers Going or Maybe.</Text>
          <Input testID="rdv-area" label="Area" value={draft.areaName ?? ""} onChangeText={(areaName) => set({ areaName })} maxLength={60} placeholder="A neighbourhood, not the street" />
        </>
      ) : null}

      <Text variant="label" color={colors.subtle}>Place</Text>
      <Pressable testID="rdv-place" accessibilityRole="button" onPress={() => void pickPlace()} style={styles.place}>
        <Text variant="body" color={draft.place ? colors.text : colors.muted} numberOfLines={1}>{draft.place ? draft.place.name : "Choose a place"}</Text>
      </Pressable>

      <Text variant="label" color={colors.subtle}>Day</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {days.map((day) => (
          <PickChip key={day} testID={`rdv-day-${day}`} label={formatDay(day, now)} selected={startOfDay(start) === day} onPress={() => set({ startsAt: withDay(start, day) })} />
        ))}
      </ScrollView>
      <Stepper label="Start" testID="rdv-start" value={formatTime(start)} onMinus={() => set({ startsAt: withTimeShift(start, -STEP_MIN) })} onPlus={() => set({ startsAt: withTimeShift(start, STEP_MIN) })} />
      <Stepper
        label="End"
        testID="rdv-end"
        value={draft.durationMin === null ? `None  ·  ends ${formatTime(start + DEFAULT_DURATION_MS)}` : `${formatDuration(draft.durationMin)}  ·  ${formatTime(end!)}`}
        onMinus={() => set({ durationMin: stepDuration(draft.durationMin, -1) })}
        onPlus={() => set({ durationMin: stepDuration(draft.durationMin, 1) })}
      />

      <Input testID="rdv-note" label="Note" value={draft.note} onChangeText={(note) => set({ note })} maxLength={NOTE_MAX} multiline placeholder="Optional" />

      <Text variant="label" color={colors.subtle}>Crews</Text>
      <View style={styles.wrap}>
        {crewState.crews.map((crew) => (
          <PickChip key={crew.id} testID={`rdv-crew-${crew.id}`} label={crew.name} tint={crewStyle(crew.styleIndex).tint} selected={draft.crewIds.includes(crew.id)} onPress={() => toggleCrew(crew.id)} />
        ))}
      </View>

      <Stepper label="Arrival radius" testID="rdv-radius" value={`${draft.radiusM} m`} onMinus={() => set({ radiusM: stepRadius(draft.radiusM, -1) })} onPlus={() => set({ radiusM: stepRadius(draft.radiusM, 1) })} />
      <Text variant="caption" muted>Members inside this radius during the RDV can be marked as arrived. Steps of {RADIUS_STEP} m.</Text>

      <Disclaimer text={DISCLAIMER_PLACES} />
      {touched && error ? <Banner tone="error" text={messageFor(new AppError(error))} /> : null}
      {save.error ? <Banner tone="error" text={save.error} /> : null}
      <Button testID="rdv-save" title={editing ? "Save changes" : "Create RDV"} onPress={() => void save.run()} loading={save.loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  days: { gap: 8 },
  place: { minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.fill, justifyContent: "center", paddingHorizontal: 14 },
  stepper: { gap: 6 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.fill, padding: 4 },
  stepButton: { width: 44, height: 40, borderRadius: radii.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.raised },
});
