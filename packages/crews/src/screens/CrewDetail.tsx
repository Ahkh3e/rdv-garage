import { View } from "react-native";
import { Alert, Share } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar, Button, Card, Divider, Row, Screen, Slot, Text, colors, crewStyle, crewUrl, messageFor, useCrewState, useShell, useSession } from "@rdv/core";
import { loadCrews } from "../data";

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

  const memberActions = (userId: string, handle: string) => {
    if (!isOwner || userId === me) return;
    Alert.alert(`@${handle}`, undefined, [
      { text: "Make owner", onPress: () => confirm("Transfer ownership?", `@${handle} becomes the owner and you become a member.`, () => run(() => shell.backend.rpc("crews", "transfer_ownership", { p_crew: crew.id, p_user: userId })), "Transfer") },
      { text: "Remove from crew", style: "destructive", onPress: () => confirm("Remove member?", `@${handle} will no longer see this crew.`, () => run(() => shell.backend.rpc("crews", "remove_member", { p_crew: crew.id, p_user: userId })), "Remove") },
      { text: "Cancel", style: "cancel" },
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
              subtitle={`${m.role === "owner" ? "Owner" : "Member"}${m.live ? "  ·  Live now" : ""}`}
              left={<Avatar handle={m.handle} path={m.avatarPath} ring={m.live ? colors.accentBright : undefined} />}
              right={isOwner && m.userId !== me ? <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} /> : undefined}
              onPress={isOwner && m.userId !== me ? () => memberActions(m.userId, m.handle) : undefined}
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
