import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { RDV_DETAIL_SLOT, Banner, Button, Card, Empty, Screen, Slot, Text, colors, useAction, useCrewState, useDistanceLabel, useLiveState, useSession, useShell } from "@rdv/core";
import { EDIT_ROUTE, REFRESH_MS, type Person } from "./controller";
import { useController } from "./context";
import { formatWhen } from "./format";
import { ANSWER_LABELS, KIND_LABELS, canAnswer, canCancel, canEdit, canMarkHere, hasEnded, isHappening, type Answer } from "./model";
import { LiveBadge, PickChip, StatusBadge, useNow, useRdvs } from "./ui";

const ANSWERS: Answer[] = ["going", "maybe", "cant"];

export function RdvDetail({ navigation, route }: { navigation: any; route: { params: { id: string } } }) {
  const shell = useShell();
  const controller = useController();
  const session = useSession();
  const crews = useCrewState().crews;
  const live = useLiveState();
  const now = useNow(15000);
  const rdv = useRdvs().find((r) => r.id === route.params.id) ?? null;
  const away = useDistanceLabel(rdv?.place);
  const me = session.status === "signedIn" ? session.userId : null;
  const [people, setPeople] = useState<Person[]>([]);
  const [offer, setOffer] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const answers = rdv ? `${rdv.going}-${rdv.maybe}-${rdv.cant}-${rdv.arrived}` : "";
  const rdvId = rdv?.id;
  useEffect(() => {
    if (!rdvId) return;
    let active = true;
    const load = () => controller.people(rdvId).then((rows) => active && setPeople(rows)).catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [controller, rdvId, answers]);

  const answer = useAction(async (value: Answer) => {
    await controller.setRsvp(rdv!.id, value);
  });
  const here = useAction(async () => {
    setNotice(null);
    await controller.markHere(rdv!.id);
    setNotice("Arrival recorded.");
    if (!live.live) setOffer(true);
  });
  const cancel = useAction(async () => {
    await controller.cancel(rdv!.id);
  });

  if (!rdv) {
    return (
      <Screen>
        <Empty title="This RDV is gone" body="It was cancelled and its time has passed, or you are no longer in its crew." action={<Button title="Back" variant="secondary" onPress={() => navigation.goBack()} />} />
      </Screen>
    );
  }

  const ended = hasEnded(rdv, now);
  const cancelled = rdv.status === "cancelled";
  const confirmCancel = () =>
    Alert.alert("Cancel this RDV?", "People who answered will see it marked cancelled.", [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel RDV", style: "destructive", onPress: () => void cancel.run() },
    ]);

  return (
    <Screen>
      <View style={styles.titleLine}>
        <Text variant="large" style={{ flexShrink: 1 }}>{rdv.title}</Text>
      </View>
      <View style={styles.badges}>
        <StatusBadge label={KIND_LABELS[rdv.kind].toUpperCase()} />
        {cancelled ? <StatusBadge label="CANCELLED" /> : isHappening(rdv, now) ? <LiveBadge /> : ended ? <StatusBadge label="ENDED" /> : null}
      </View>
      {cancelled ? <Banner text="This RDV was cancelled." /> : null}

      <Card style={styles.card}>
        <Text variant="label" muted>When</Text>
        <Text variant="body" testID="rdv-when">{formatWhen(rdv.startsAt, rdv.endsAt, now)}</Text>
        <Text variant="label" muted>Where</Text>
        {rdv.place ? (
          <Text variant="body" testID="rdv-where">{away ? `${rdv.place.name}  ·  ${away} away` : rdv.place.name}</Text>
        ) : (
          <>
            <Text variant="body">{rdv.areaName}</Text>
            <Text variant="caption" muted>The exact place is shown to people who answer Going or Maybe.</Text>
          </>
        )}
        <Text variant="label" muted>Host</Text>
        <Text variant="body" testID="rdv-host">{rdv.hostHandle ? `@${rdv.hostHandle}` : "Former member"}</Text>
        {rdv.note ? (
          <>
            <Text variant="label" muted>Note</Text>
            <Text variant="body">{rdv.note}</Text>
          </>
        ) : null}
      </Card>

      {rdv.place && !cancelled && !ended ? <Button testID="rdv-directions" title="Directions" variant="secondary" onPress={() => void controller.directions(rdv)} /> : null}

      <Text variant="label" muted>Your answer</Text>
      {canAnswer(rdv, now) ? (
        <View style={styles.badges}>
          {ANSWERS.map((value) => (
            <PickChip key={value} testID={`rsvp-${value}`} label={ANSWER_LABELS[value]} selected={rdv.myAnswer === value} onPress={() => void answer.run(value)} />
          ))}
        </View>
      ) : (
        <Text variant="body" muted>{rdv.myAnswer ? `You answered ${ANSWER_LABELS[rdv.myAnswer]}.` : "No answer."} Answers are closed.</Text>
      )}
      {answer.error ? <Banner tone="error" text={answer.error} /> : null}

      {canMarkHere(rdv, now) ? <Button testID="rdv-here" title="I'm here" onPress={() => void here.run()} loading={here.loading} /> : null}
      {rdv.arrived ? <Banner text="You're marked as arrived." /> : null}
      {here.error ? <Banner tone="error" text={here.error} /> : null}
      {notice && !here.error ? <Text variant="caption" muted>{notice}</Text> : null}
      {offer ? (
        <Card style={styles.card}>
          <Text variant="headline">Go live for this RDV?</Text>
          <Text variant="body" muted>Your crew sees where you are only while you are live.</Text>
          <Button testID="rdv-offer-go-live" title="Open Go live" onPress={() => { setOffer(false); shell.requestGoLive(rdv.crewIds.filter((id) => crews.some((c) => c.id === id))); }} />
          <Button testID="rdv-offer-dismiss" title="Not now" variant="ghost" onPress={() => setOffer(false)} />
        </Card>
      ) : null}

      <Text variant="label" muted>Who is going</Text>
      <Card style={styles.card}>
        {ANSWERS.map((value) => {
          const list = people.filter((p) => p.answer === value);
          const count = value === "going" ? rdv.going : value === "maybe" ? rdv.maybe : rdv.cant;
          return (
            <View key={value} style={{ gap: 2 }}>
              <Text variant="headline" testID={`count-${value}`}>{`${ANSWER_LABELS[value]}  ${count}`}</Text>
              {list.length > 0 ? <Text variant="body" muted>{list.map((p) => `@${p.handle}${p.arrived ? " (here)" : ""}`).join(", ")}</Text> : null}
            </View>
          );
        })}
      </Card>

      <Slot name={RDV_DETAIL_SLOT} rdvId={rdv.id} isHost={rdv.hostId === me} ended={ended} cancelled={cancelled} />

      {canEdit(rdv, me, now) ? <Button testID="rdv-edit" title="Edit" variant="secondary" onPress={() => navigation.navigate(EDIT_ROUTE, { id: rdv.id })} /> : null}
      {canCancel(rdv, me, crews, now) ? <Button testID="rdv-cancel" title="Cancel RDV" variant="danger" onPress={confirmCancel} loading={cancel.loading} /> : null}
      {cancel.error ? <Banner tone="error" text={cancel.error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  badges: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  card: { padding: 16, gap: 8, borderColor: colors.hairline },
});
