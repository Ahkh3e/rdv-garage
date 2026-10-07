import { useState } from "react";
import { Banner, Button, Input, Screen, Text, useAction, useShell } from "@rdv/core";

export function ChangePassword({ navigation }: { navigation: any }) {
  const shell = useShell();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const change = useAction(async () => {
    await shell.backend.auth.changePassword(current, next);
    setDone(true);
    setCurrent("");
    setNext("");
  });
  return (
    <Screen>
      <Text muted>Changing your password signs out your other devices.</Text>
      <Input testID="change-current" label="Current password" secureTextEntry textContentType="password" value={current} onChangeText={setCurrent} />
      <Input testID="change-new" label="New password" secureTextEntry textContentType="newPassword" value={next} onChangeText={setNext} hint="At least 8 characters." error={change.error} />
      {done ? <Banner text="Password changed. Other devices were signed out." /> : null}
      <Button title="Change password" testID="change-submit" loading={change.loading} disabled={!current || next.length < 8} onPress={() => change.run()} />
      <Button title="Done" variant="ghost" onPress={() => navigation.goBack()} />
    </Screen>
  );
}
