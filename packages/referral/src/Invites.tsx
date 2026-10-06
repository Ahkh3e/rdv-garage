import { useCallback, useState } from "react";
import { Alert, Share, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Chip, Empty, Screen, Text, colors, inviteUrl, messageFor, useAction, useShell } from "@rdv/core";

interface InviteRow {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  status: "active" | "expired" | "revoked" | "disabled";
  joined: { handle: string; joined_at: string }[];
}

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `Expires in ${hours}h ${minutes % 60}m` : `Expires in ${minutes}m`;
}

export function Invites() {
  const shell = useShell();
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInvites(await shell.backend.rpc<InviteRow[]>("referral", "list_my_invites"));
      setError(null);
    } catch (e) {
      setError(messageFor(e));
    }
  }, [shell]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const share = (code: string) => {
    const url = inviteUrl(shell.config, code);
    return Share.share({ message: `Join me on RDV Garage. It's invite only and this link works for 24 hours: ${url}`, url });
  };

  const create = useAction(async () => {
    const rows = await shell.backend.rpc<{ code: string }[]>("referral", "create_invite");
    await load();
    await share(rows[0]!.code);
  });

  const revoke = (invite: InviteRow) =>
    Alert.alert("Revoke this invite?", "The link will stop working for anyone who hasn't joined yet.", [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: async () => { await shell.backend.rpc("referral", "revoke_invite", { p_id: invite.id }).catch((e) => setError(messageFor(e))); load(); } },
    ]);

  return (
    <Screen onRefresh={load} refreshing={false}>
      <Text variant="title">Share invite</Text>
      <Text muted>Each invite is a link that works for 24 hours and can be used by anyone you send it to. There is no limit on how many you create.</Text>
      <Button title="Create and share invite" testID="invite-create" loading={create.loading} onPress={() => create.run()} />
      {create.error || error ? <Text color={colors.danger}>{create.error ?? error}</Text> : null}
      <Text variant="label" muted>Your invites</Text>
      {invites && invites.length === 0 ? <Empty icon="paper-plane-outline" title="No invites yet" body="Create one to bring someone in." /> : null}
      {(invites ?? []).map((invite) => (
        <Card key={invite.id} style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text variant="mono" selectable>{invite.code}</Text>
            <Chip label={invite.status === "active" ? timeLeft(invite.expires_at) : invite.status[0]!.toUpperCase() + invite.status.slice(1)} selected={invite.status === "active"} />
          </View>
          <Text variant="caption" muted>
            {invite.joined.length === 0 ? "Nobody has joined yet" : `Joined: ${invite.joined.map((j) => `@${j.handle}`).join(", ")}`}
          </Text>
          {invite.status === "active" ? (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Button title="Share again" variant="secondary" style={{ flex: 1 }} onPress={() => share(invite.code)} />
              <Button title="Revoke" variant="ghost" onPress={() => revoke(invite)} />
            </View>
          ) : null}
        </Card>
      ))}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
        <Text variant="caption" muted style={{ flex: 1 }}>Only share with people you trust. Everyone who joins through your invite is linked to you.</Text>
      </View>
    </Screen>
  );
}
