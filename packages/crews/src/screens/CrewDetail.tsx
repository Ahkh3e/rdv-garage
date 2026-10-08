import { View } from "react-native";
import { Alert, Share } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar, Button, Card, Divider, Row, Screen, Slot, Text, colors, crewStyle, crewUrl, messageFor, useCrewState, useShell, useSession } from "@rdv/core";
import type { CrewRole } from "@rdv/core";
import { loadCrews } from "../data";

const ROLE_LABELS: Record<CrewRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export function CrewDetail({ navigation, route }: { navigation: any; route: { params: { id: string } } }) {
  const shell = useShell();
  const session = useSession();
  const state = useCrewState();
  const crew = state.crews.find((c) => c.id === route.params.id);
  const me = session.status === "signedIn" ? session.userId : null;
  if (!crew) {
    return (
      <Screen>
        <Text muted>This crew is no longer available.</Text>
        <Button title="Back" variant="secondary" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }
  const isOwner = crew.role === "owner";
  const isModerator = crew.role !== "member";
  const style = crewStyle(crew.styleIndex);

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    try {
      await action();
      await loadCrews(shell);
      after?.();
    } catch (e) {
      Alert.alert("Couldn't do that", messageFor(e));
    }
  };

  const shareLink = () => {
    if (!crew.linkCode) return;
    const url = crewUrl(shell.config, crew.linkCode);
    Share.share({ message: `Join my crew "${crew.name}" on RDV Garage: ${url}`, url });
  };

  const confirm = (title: string, message: string, onConfirm: () => void, label = "Confirm") =>
    Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: label, style: "destructive", onPress: onConfirm }]);

  const canManage = (userId: string, role: CrewRole) => userId !== me && (isOwner || (isModerator && role === "member"));

  const memberActions = (userId: string, handle: string, role: CrewRole, voiceOff: boolean) => {
    if (!canManage(userId, role)) return;
    const rpc = (fn: string) => () => run(() => shell.backend.rpc("crews", fn, { p_crew: crew.id, p_user: userId }));
    Alert.alert(`@${handle}`, undefined, [
      ...(isOwner ? [{ text: "Make owner", onPress: () => confirm("Transfer ownership?", `@${handle} becomes the owner of ${crew.name}. You become a regular member, not an admin.`, rpc("transfer_ownership"), "Transfer") }] : []),
      ...(isOwner && role === "member" ? [{ text: "Add admin", onPress: () => confirm("Add admin?", `@${handle} can remove members, cancel RDVs and remove pins for this crew.`, rpc("promote_admin"), "Add admin") }] : []),
      ...(isOwner && role === "admin" ? [{ text: "Remove admin", onPress: () => confirm("Remove admin?", `@${handle} becomes a member.`, rpc("demote_admin"), "Remove admin") }] : []),
      ...(shell.isEnabled("walkie")
        ? [voiceOff
            ? { text: "Voice on", onPress: () => run(() => shell.backend.rpc("crews", "set_voice_access", { p_crew: crew.id, p_user: userId, p_allowed: true })) }
            : { text: "Voice off", onPress: () => confirm("Turn voice off?", `@${handle} can still read and send messages in ${crew.name}'s rooms, but can't use the walkie-talkie there.`, () => run(() => shell.backend.rpc("crews", "set_voice_access", { p_crew: crew.id, p_user: userId, p_allowed: false })), "Voice off") }]
        : []),
      { text: "Remove from crew", style: "destructive" as const, onPress: () => confirm("Remove from crew", `Remove @${handle} from the crew?`, rpc("remove_member"), "Remove from crew") },
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  return (
    <Screen>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <View style={{ width: 8, height: 44, borderRadius: 4, backgroundColor: style.tint }} />
        <View style={{ flex: 1 }}>
          <Text variant="large" numberOfLines={2}>{crew.name}</Text>
          {crew.description ? <Text muted>{crew.description}</Text> : null}
        </View>
      </View>
      {isOwner && crew.linkCode ? (
        <Card style={{ padding: 16, gap: 12 }}>
          <Text variant="label" muted>Crew link</Text>
          <Text variant="body" muted>Anyone with an RDV Garage account who opens this link can join. Regenerate it any time to stop the old link working.</Text>
          <Button title="Share crew link" testID="crew-share" onPress={shareLink} />
          <Button title="Regenerate link" variant="secondary" onPress={() => confirm("Regenerate link?", "The old link will stop working.", () => run(() => shell.backend.rpc("crews", "regenerate_crew_link", { p_crew: crew.id })), "Regenerate")} />
        </Card>
      ) : null}
      <Slot name="crew.detail" crewId={crew.id} />
      <Text variant="label" muted>Members</Text>
      <Card>
        {crew.members.map((m, i) => (
          <View key={m.userId}>
            {i > 0 ? <Divider /> : null}
            <Row
              title={`@${m.handle}${m.userId === me ? " (you)" : ""}`}
              subtitle={`${ROLE_LABELS[m.role]}${m.live ? "  ·  Live now" : ""}${m.voiceOff ? "  ·  Voice off" : ""}`}
              left={<Avatar handle={m.handle} path={m.avatarPath} ring={m.live ? colors.accentBright : undefined} />}
              right={canManage(m.userId, m.role) ? <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} /> : undefined}
              onPress={canManage(m.userId, m.role) ? () => memberActions(m.userId, m.handle, m.role, m.voiceOff === true) : undefined}
            />
          </View>
        ))}
      </Card>
      {isOwner ? (
        <Button title="Delete crew" variant="danger" onPress={() => confirm("Delete this crew?", "Everyone is removed and the link stops working.", () => run(() => shell.backend.rpc("crews", "delete_crew", { p_crew: crew.id }), () => navigation.goBack()), "Delete")} />
      ) : (
        <Button title="Leave crew" variant="danger" onPress={() => confirm("Leave this crew?", "You'll stop seeing this crew. Rejoin with a crew link.", () => run(() => shell.backend.rpc("crews", "leave_crew", { p_crew: crew.id }), () => navigation.goBack()), "Leave")} />
      )}
      {isOwner && crew.members.length > 1 ? <Text variant="caption" muted>Owners must transfer ownership before leaving. Tap a member to do that.</Text> : null}
    </Screen>
  );
}
