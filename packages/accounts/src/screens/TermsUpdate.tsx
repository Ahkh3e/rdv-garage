import { View } from "react-native";
import { Button, Screen, TERMS_VERSION, Text, useAction, useShell } from "@rdv/core";
import { LegalText } from "./Legal";

export function TermsUpdate() {
  const shell = useShell();
  const accept = useAction(async () => {
    await shell.backend.rpc("accounts", "accept_terms", { p_version: TERMS_VERSION });
    shell.session.set((prev) => (prev.status === "signedIn" ? { ...prev, profile: { ...prev.profile, termsVersion: TERMS_VERSION } } : prev));
  });
  return (
    <Screen scroll={false}>
      <Text variant="title">Updated safety terms</Text>
      <Text muted>Chat rooms and the walkie-talkie are new. Read the updated terms and accept them to keep using RDV Garage.</Text>
      <View style={{ flex: 1 }}>
        <LegalText />
      </View>
      {accept.error ? <Text color="#FF453A">{accept.error}</Text> : null}
      <Button title="Accept and continue" testID="terms-accept" loading={accept.loading} onPress={() => accept.run()} />
      <Button title="Sign out" variant="ghost" onPress={() => void shell.backend.auth.signOut()} />
    </Screen>
  );
}
