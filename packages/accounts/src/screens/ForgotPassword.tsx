import { useState } from "react";
import { Banner, Button, Input, Screen, Text, useAction, useShell } from "@rdv/core";

export function ForgotPassword({ route }: { route: { params?: { email?: string } } }) {
  const shell = useShell();
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [sent, setSent] = useState(false);
  const send = useAction(async () => {
    await shell.backend.auth.requestPasswordReset(email);
    setSent(true);
  });
  return (
    <Screen>
      <Text variant="title">Reset your password</Text>
      <Text muted>Enter your email and we'll send a reset link.</Text>
      <Input label="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} error={send.error} />
      {sent ? <Banner text="If that email has an account, a reset link is on its way. Open it on this phone." /> : null}
      <Button title={sent ? "Send again" : "Send reset link"} loading={send.loading} disabled={!email} onPress={() => send.run()} />
    </Screen>
  );
}
