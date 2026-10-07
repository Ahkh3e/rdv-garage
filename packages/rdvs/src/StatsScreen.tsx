import { useEffect, useState } from "react";
import { Banner, Card, Row, Screen, Text, messageFor } from "@rdv/core";
import { useController } from "./context";

export function StatsScreen() {
  const controller = useController();
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    controller.meetsAttended().then((n) => active && setCount(n), (e) => active && setError(messageFor(e)));
    return () => {
      active = false;
    };
  }, [controller]);

  return (
    <Screen>
      <Text variant="large">Stats</Text>
      {error ? <Banner tone="error" text={error} /> : null}
      <Card>
        <Row title="Meets attended" subtitle="Arrivals verified at an RDV" right={<Text testID="stats-meets" variant="headline">{count === null ? "" : String(count)}</Text>} />
      </Card>
    </Screen>
  );
}
