import { Card, Divider, Empty, Screen, Text, useCrewState } from "@rdv/core";
import { View } from "react-native";
import { useController } from "./context";
import { splitPlans, inCrews } from "./model";
import { RdvRow, useNow, useRdvs } from "./ui";

export function PlansScreen() {
  const controller = useController();
  const crewState = useCrewState();
  const all = useRdvs();
  const now = useNow();
  const rdvs = all.filter((rdv) => inCrews(rdv, crewState.selected));
  const { upcoming, past } = splitPlans(rdvs, now);

  return (
    <Screen onRefresh={() => void controller.refresh()}>
      <Text variant="large">Plans</Text>
      {upcoming.length === 0 && past.length === 0 ? (
        <Empty title="No RDVs yet" body={crewState.selected.length === 0 ? "Select a crew on the map to see its RDVs." : "RDVs for your selected crews show up here. Drop one from a place on the map."} />
      ) : null}
      {upcoming.length > 0 ? (
        <>
          <Text variant="label" muted>Upcoming</Text>
          <Card>
            {upcoming.map((rdv, i) => (
              <View key={rdv.id}>
                {i > 0 ? <Divider /> : null}
                <RdvRow rdv={rdv} now={now} onPress={() => controller.open(rdv.id)} />
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {past.length > 0 ? (
        <>
          <Text variant="label" muted>Past</Text>
          <Card>
            {past.map((rdv, i) => (
              <View key={rdv.id}>
                {i > 0 ? <Divider /> : null}
                <RdvRow rdv={rdv} now={now} onPress={() => controller.open(rdv.id)} />
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
