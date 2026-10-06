import { useState } from "react";
import { Banner, Button, Input, Screen, Text, useAction, useShell } from "@rdv/core";

export function ResetPassword({ navigation }: { navigation: any }) {
  const shell = useShell();
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const reset = useAction(async () => {
    await shell.backend.auth.completePasswordReset(next);
    setDone(true);
  });
  return (
    <Screen>
      <Text variant="title">Choose a new password</Text>
      <Input label="New password" secureTextEntry textContentType="newPassword" value={next} onChangeText={setNext} hint="At least 8 characters. Your other devices will be signed out." error={reset.error} />
      {done ? <Banner text="Password updated." /> : null}
      {done ? (
        <Button title="Continue" onPress={() => navigation.navigate("Tabs")} />
      ) : (
        <Button title="Set password" loading={reset.loading} disabled={next.length < 8} onPress={() => reset.run()} />
      )}
    </Screen>
  );
}
