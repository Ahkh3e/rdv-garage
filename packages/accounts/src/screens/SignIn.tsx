import { useState } from "react";
import { Button, Input, Screen, Text, useAction, useShell } from "@rdv/core";

export function SignIn({ navigation, route }: { navigation: any; route: { params?: { email?: string } } }) {
  const shell = useShell();
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [password, setPassword] = useState("");
  const signIn = useAction(() => shell.backend.auth.signIn(email, password));
  return (
    <Screen>
      <Text variant="title">Sign in</Text>
      <Input testID="signin-email" label="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="email" value={email} onChangeText={setEmail} />
      <Input testID="signin-password" label="Password" secureTextEntry textContentType="password" autoComplete="current-password" value={password} onChangeText={setPassword} error={signIn.error} />
      <Button title="Sign in" testID="signin-submit" loading={signIn.loading} disabled={!email || !password} onPress={() => signIn.run()} />
      <Button title="Forgot password" variant="ghost" onPress={() => navigation.navigate("ForgotPassword", { email })} />
    </Screen>
  );
}
