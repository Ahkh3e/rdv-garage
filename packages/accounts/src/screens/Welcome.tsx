import { useEffect } from "react";
import { Platform, View } from "react-native";
import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import { Banner, Button, Disclaimer, Screen, Text, colors, useStore } from "@rdv/core";
import { useShell } from "@rdv/core";
import { extractInviteCode, pendingInvite } from "../state";

export function Welcome({ navigation }: { navigation: any }) {
  const shell = useShell();
  const invite = useStore(pendingInvite);
  const session = useStore(shell.session);
  const notice = session.status === "signedOut" ? session.notice : undefined;

  // First launch after installing from an invite: pick the code up from the install referrer (Android) or the clipboard (iPhone).
  useEffect(() => {
    if (pendingInvite.get()) return;
    (async () => {
      try {
        if (Platform.OS === "android") {
          const referrer = await Application.getInstallReferrerAsync();
          const code = extractInviteCode(referrer);
          if (code) return pendingInvite.set(code);
        } else if (await Clipboard.hasStringAsync()) {
          const code = extractInviteCode(await Clipboard.getStringAsync());
          if (code) pendingInvite.set(code);
        }
      } catch {
        // Denied or unavailable: the person can type the code.
      }
    })();
  }, []);

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: 28, paddingVertical: 40 }}>
        <View style={{ gap: 10 }}>
          <Text variant="label" color={colors.accent}>Invite only</Text>
          <Text variant="large" style={{ fontSize: 40, lineHeight: 44 }}>RDV{"\n"}Garage</Text>
          <Text muted>Private crews. One live map. Built for the Toronto car scene.</Text>
        </View>
        {notice === "suspended" ? <Banner tone="error" text="This account has been suspended." /> : null}
        {notice === "deleted" ? <Banner text="That account no longer exists." /> : null}
        {invite ? <Banner text="Invite found. Create your account to join." /> : null}
        <View style={{ gap: 12 }}>
          {invite ? (
            <Button title="Create account" testID="welcome-create" onPress={() => navigation.navigate("CreateAccount", { code: invite })} />
          ) : (
            <Button title="I have an invite" testID="welcome-invite" onPress={() => navigation.navigate("EnterInvite")} />
          )}
          <Button title="Sign in" variant="secondary" testID="welcome-signin" onPress={() => navigation.navigate("SignIn")} />
        </View>
      </View>
      <Disclaimer />
    </Screen>
  );
}
