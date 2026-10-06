import { useEffect, useState } from "react";
import { Button, Input, Screen, Text, useAction, useShell } from "@rdv/core";
import { loadCrews } from "../data";

function extractCrewCode(text: string): string {
  const fromLink = text.match(/\/c\/([A-Za-z0-9]+)/);
  return (fromLink?.[1] ?? text).trim().toUpperCase();
}

export function JoinCrew({ navigation, route }: { navigation: any; route: { params?: { code?: string } } }) {
  const shell = useShell();
  const [text, setText] = useState(route.params?.code ?? "");
  const join = useAction(async () => {
    const id = await shell.backend.rpc<string>("crews", "join_crew", { p_link_code: extractCrewCode(text) });
    await loadCrews(shell);
    navigation.replace("CrewDetail", { id });
  });
  useEffect(() => {
    if (route.params?.code) join.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.code]);
  return (
    <Screen>
      <Text variant="title">Join a crew</Text>
      <Text muted>Paste the crew link or code the owner shared.</Text>
      <Input testID="join-code" autoCapitalize="characters" autoCorrect={false} placeholder="Crew link or code" value={text} onChangeText={setText} error={join.error} />
      <Button title="Join crew" testID="join-submit" loading={join.loading} disabled={text.trim().length < 6} onPress={() => join.run()} />
    </Screen>
  );
}
