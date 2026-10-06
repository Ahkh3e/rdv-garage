import { useState } from "react";
import { Banner, Button, Input, Screen, Text, codeOf, messageFor, useAction, useShell } from "@rdv/core";

export function ResetPassword({ navigation }: { navigation: any }) {
  const shell = useShell();
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const reset = useAction(async () => {
    try {
      await shell.backend.auth.completePasswordReset(next);
    } catch (error) {
      // The password was changed but other devices may still be signed in: tell the person, do not hide it.
      if (codeOf(error) !== "revoke_failed") throw error;
      setWarning(messageFor(error));
    }
    setDone(true);
  });
  return (
    <Screen>
      <Text variant="title">Choose a new password</Text>
      <Input label="New password" secureTextEntry textContentType="newPassword" value={next} onChangeText={setNext} hint="At least 8 characters. Your other devices will be signed out." error={reset.error} />
      {done ? <Banner text="Password updated." /> : null}
      {warning ? <Banner tone="error" text={warning} /> : null}
      {done ? (
        <Button title="Continue" onPress={() => navigation.navigate("Tabs")} />
      ) : (
        <Button title="Set password" loading={reset.loading} disabled={next.length < 8} onPress={() => reset.run()} />
      )}
    </Screen>
  );
}
