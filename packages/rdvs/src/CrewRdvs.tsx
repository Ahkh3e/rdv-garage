import { Card, Divider, Text } from "@rdv/core";
import { View } from "react-native";
import { useController } from "./context";
import { upcomingFor } from "./model";
import { RdvRow, useNow, useRdvs } from "./ui";

export function CrewRdvs({ crewId }: { crewId: string }) {
  const controller = useController();
  const now = useNow();
  const upcoming = upcomingFor(useRdvs(), crewId, now);
  return (
    <>
      <Text variant="label" muted>Upcoming RDVs</Text>
      {upcoming.length === 0 ? (
        <Text testID="crew-rdvs-empty" variant="body" muted>No upcoming RDVs. Drop one from a place on the map.</Text>
      ) : (
        <Card>
          {upcoming.map((rdv, i) => (
            <View key={rdv.id}>
              {i > 0 ? <Divider /> : null}
              <RdvRow rdv={rdv} now={now} onPress={() => controller.open(rdv.id)} />
            </View>
          ))}
        </Card>
      )}
    </>
  );
}
