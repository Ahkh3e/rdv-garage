import { useState } from "react";
import { Button, Input, Screen, Text, useAction, useSession, useShell } from "@rdv/core";

export function DeleteAccount() {
  const shell = useShell();
  const session = useSession();
  const [typed, setTyped] = useState("");
  const handle = session.status === "signedIn" ? session.profile.handle : "";
  const remove = useAction(async () => {
    await shell.backend.invoke("delete-account");
    shell.events.emit({ type: "account.deleted" });
    await shell.backend.auth.signOut();
  });
  return (
    <Screen>
      <Text variant="title">Delete your account</Text>
      <Text muted>
        This removes your profile, email, devices, and driving data. Crews you own pass to their longest-standing member, or are deleted if you are the only one in them. This can't be undone.
      </Text>
      <Input testID="delete-confirm" label={`Type ${handle} to confirm`} autoCapitalize="none" autoCorrect={false} value={typed} onChangeText={setTyped} error={remove.error} />
      <Button title="Delete my account" variant="danger" testID="delete-submit" loading={remove.loading} disabled={typed.trim().toLowerCase() !== handle} onPress={() => remove.run()} />
    </Screen>
  );
}
