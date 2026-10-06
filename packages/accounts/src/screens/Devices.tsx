import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Divider, Empty, Row, Screen, Text, colors, messageFor, useShell, type DeviceSession } from "@rdv/core";

function describe(agent: string | null): string {
  if (!agent) return "Device";
  if (/iphone|ios|cfnetwork|darwin/i.test(agent)) return "iPhone";
  if (/android|okhttp|dalvik/i.test(agent)) return "Android phone";
  return "Device";
}

export function Devices() {
  const shell = useShell();
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setSessions(await shell.backend.auth.listSessions());
      setError(null);
    } catch (e) {
      setError(messageFor(e));
    }
  }, [shell]);
  useEffect(() => void load(), [load]);

  const revoke = (s: DeviceSession) =>
    Alert.alert("Sign out that device?", `${describe(s.userAgent)} will be signed out.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out device", style: "destructive", onPress: async () => { await shell.backend.auth.revokeSession(s.id).catch((e) => setError(messageFor(e))); load(); } },
    ]);

  return (
    <Screen onRefresh={load} refreshing={false}>
      <Text muted>Devices signed in to your account.</Text>
      {error ? <Text color={colors.danger}>{error}</Text> : null}
      {sessions && sessions.length === 0 ? <Empty title="No devices" /> : null}
      <Card>
        {(sessions ?? []).map((s, i) => (
          <View key={s.id}>
            {i > 0 ? <Divider /> : null}
            <Row
              title={`${describe(s.userAgent)}${s.isCurrent ? " (this device)" : ""}`}
              subtitle={`Last active ${new Date(s.lastSeenAt).toLocaleString()}`}
              left={<Ionicons name="phone-portrait-outline" size={22} color={colors.muted} />}
              onPress={s.isCurrent ? undefined : () => revoke(s)}
              right={s.isCurrent ? undefined : <Ionicons name="close-circle-outline" size={20} color={colors.muted} />}
            />
          </View>
        ))}
      </Card>
      {(sessions?.length ?? 0) > 1 ? (
        <Button title="Sign out all other devices" variant="secondary" onPress={async () => { await shell.backend.auth.revokeSession("others"); load(); }} />
      ) : null}
    </Screen>
  );
}
