import { useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Input, Screen, Sheet, Text, TERMS_VERSION, codeOf, colors, messageFor, useShell } from "@rdv/core";
import { useAction } from "@rdv/core";
import { LegalText } from "./Legal";
import { pendingInvite } from "../state";

const HANDLE = /^[a-z0-9_]{3,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Check({ checked, onToggle, children, testID }: { checked: boolean; onToggle: () => void; children: React.ReactNode; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onToggle} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={checked ? colors.accentBright : colors.muted} />
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export function CreateAccount({ navigation, route }: { navigation: any; route: { params: { code: string } } }) {
  const shell = useShell();
  const { code } = route.params;
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [adult, setAdult] = useState(false);
  const [readTerms, setReadTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = useAction(async () => {
    const errors: Record<string, string> = {};
    const h = handle.trim().toLowerCase();
    if (!HANDLE.test(h)) errors.handle = "Use 3 to 20 characters: lowercase letters, numbers, underscores.";
    if (!EMAIL.test(email.trim())) errors.email = "Enter a valid email address.";
    if (password.length < 8) errors.password = "Use at least 8 characters.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    try {
      const result = await shell.backend.invokePublic<{ status: "confirmed" | "check_email" }>("register", {
        invite_code: code,
        handle: h,
        email: email.trim().toLowerCase(),
        password,
        terms_version: TERMS_VERSION,
        age_confirmed: adult,
      });
      if (result.status === "confirmed") {
        pendingInvite.set(null);
        await shell.backend.auth.signIn(email, password);
      } else {
        pendingInvite.set(null);
        navigation.replace("ConfirmEmail", { email: email.trim().toLowerCase() });
      }
    } catch (error) {
      const c = codeOf(error);
      if (c === "handle_taken" || c === "handle_invalid") setFieldErrors({ handle: messageFor(error) });
      else if (c === "email_invalid" || c === "email_in_use") setFieldErrors({ email: messageFor(error) });
      else if (c === "password_too_short") setFieldErrors({ password: messageFor(error) });
      else if (c === "invalid_invite" || c === "expired_invite" || c === "revoked_invite") {
        pendingInvite.set(null);
        navigation.replace("InviteExpired", { status: c === "expired_invite" ? "expired" : c === "revoked_invite" ? "revoked" : "invalid" });
      } else throw error;
    }
  });

  return (
    <Screen>
      <Text variant="title">Create your account</Text>
      <Input testID="create-handle" label="Handle" autoCapitalize="none" autoCorrect={false} placeholder="your_handle" value={handle} onChangeText={setHandle} error={fieldErrors.handle} hint="3 to 20 characters. Other members see this." />
      <Input testID="create-email" label="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="email" value={email} onChangeText={setEmail} error={fieldErrors.email} hint="Used for confirmation and recovery. Never shown to others." />
      <Input testID="create-password" label="Password" secureTextEntry textContentType="newPassword" autoComplete="new-password" value={password} onChangeText={setPassword} error={fieldErrors.password} hint="At least 8 characters." />
      <View style={{ gap: 16, marginTop: 4 }}>
        <Check testID="create-adult" checked={adult} onToggle={() => setAdult(!adult)}>
          <Text>I am 18 or older and licensed to drive where I drive.</Text>
        </Check>
        <Check testID="create-terms" checked={terms} onToggle={() => setTerms(!terms)}>
          <Text>
            I have read and accept the safety terms. <Text color={colors.accentBright} onPress={() => setReadTerms(true)}>Read them</Text>
          </Text>
        </Check>
      </View>
      {submit.error ? <Text color={colors.danger}>{submit.error}</Text> : null}
      <Button title="Create account" testID="create-submit" loading={submit.loading} disabled={!terms || !adult || !handle || !email || !password} onPress={() => submit.run()} />
      <Sheet visible={readTerms} onClose={() => setReadTerms(false)} title="Safety terms">
        <View style={{ maxHeight: 420 }}>
          <LegalText />
        </View>
        <Button title="Close" variant="secondary" onPress={() => setReadTerms(false)} />
      </Sheet>
    </Screen>
  );
}
