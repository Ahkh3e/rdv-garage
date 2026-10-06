import { useState } from "react";
import { Button, Input, Screen, Text, useAction, useShell } from "@rdv/core";
import { CODE_PATTERN, extractInviteCode, pendingInvite } from "../state";

export function EnterInvite({ navigation }: { navigation: any }) {
  const shell = useShell();
  const [text, setText] = useState("");
  const code = extractInviteCode(text) ?? text.trim().toUpperCase();
  const check = useAction(async () => {
    if (!CODE_PATTERN.test(code)) return navigation.navigate("InviteExpired", { status: "invalid" });
    const status = await shell.backend.rpc<string>("referral", "check_invite", { p_code: code });
    if (status === "valid") {
      pendingInvite.set(code);
      navigation.navigate("CreateAccount", { code });
    } else {
      navigation.navigate("InviteExpired", { status });
    }
  });
  return (
    <Screen>
      <Text variant="title">Enter your invite code</Text>
      <Text muted>Paste the invite link or type the 12-character code you were sent.</Text>
      <Input
        testID="invite-code"
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="Invite code or link"
        value={text}
        onChangeText={setText}
        error={check.error}
      />
      <Button title="Continue" testID="invite-continue" loading={check.loading} disabled={text.trim().length < 6} onPress={() => check.run()} />
    </Screen>
  );
}
