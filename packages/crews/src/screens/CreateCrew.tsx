import { useState } from "react";
import { Button, Input, Screen, Text, useAction, useShell } from "@rdv/core";
import { loadCrews } from "../data";

export function CreateCrew({ navigation }: { navigation: any }) {
  const shell = useShell();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useAction(async () => {
    const rows = await shell.backend.rpc<{ id: string }[]>("crews", "create_crew", { p_name: name.trim(), p_description: description.trim() || null });
    await loadCrews(shell);
    navigation.replace("CrewDetail", { id: rows[0]!.id });
  });
  return (
    <Screen>
      <Text variant="title">New crew</Text>
      <Input testID="crew-name" label="Name" value={name} onChangeText={setName} maxLength={30} hint="3 to 30 characters." error={create.error} />
      <Input testID="crew-description" label="Description (optional)" value={description} onChangeText={setDescription} maxLength={140} multiline />
      <Button title="Create crew" testID="crew-create-submit" loading={create.loading} disabled={name.trim().length < 3} onPress={() => create.run()} />
    </Screen>
  );
}
