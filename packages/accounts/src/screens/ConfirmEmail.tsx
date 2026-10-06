import { useState } from "react";
import { Banner, Button, Empty, Screen, useAction, useShell } from "@rdv/core";

export function ConfirmEmail({ navigation, route }: { navigation: any; route: { params: { email: string } } }) {
  const shell = useShell();
  const { email } = route.params;
  const [resent, setResent] = useState(false);
  const resend = useAction(async () => {
    await shell.backend.auth.resendConfirmation(email);
    setResent(true);
  });
  return (
    <Screen>
      <Empty
        icon="mail-outline"
        title="Check your email"
        body={`We sent a confirmation link to ${email}. Open it, then sign in. Unconfirmed accounts are removed after 24 hours.`}
      />
      {resent ? <Banner text="Sent again." /> : null}
      {resend.error ? <Banner tone="error" text={resend.error} /> : null}
      <Button title="I've confirmed, sign in" testID="confirm-signin" onPress={() => navigation.navigate("SignIn", { email })} />
      <Button title="Resend email" variant="secondary" loading={resend.loading} onPress={() => resend.run()} />
    </Screen>
  );
}
