import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar, Banner, Button, Card, Divider, Empty, Row, Screen, Text, Toggle, colors, messageFor, useCrewState, useSession, useStore } from "@rdv/core";
import type { ChatMemberRole, ChatRoomMember } from "@rdv/core/chat";
import { useController } from "./context";
import { membersOfCrews } from "./model";

const ROLE_LABELS: Record<ChatMemberRole, string> = { owner: "Owner", admin: "Admin", member: "Member", host: "Host" };
const KEPT = "Messages are kept for 7 days. Rooms are run by members.";

export function RoomInfo({ navigation, route }: { navigation: any; route: { params: { roomId: string } } }) {
  const { roomId } = route.params;
  const controller = useController();
  const room = useStore(controller.state).rooms.find((r) => r.id === roomId);
  const session = useSession();
  const crews = useCrewState().crews;
  const me = session.status === "signedIn" ? session.userId : null;
  const [members, setMembers] = useState<ChatRoomMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => controller.members(roomId).then(setMembers).catch(() => undefined), [controller, roomId]);
  useEffect(() => void load(), [load]);

  const candidates = useMemo(() => {
    const inRoom = new Set(members.map((m) => m.userId));
    return membersOfCrews(crews, me).filter((p) => !inRoom.has(p.userId));
  }, [crews, me, members]);

  if (!room) {
    return (
      <Screen>
        <Empty title="This room is gone" action={<Button title="Back" variant="secondary" onPress={() => navigation.popToTop()} />} />
      </Screen>
    );
  }

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await action();
      await load();
      after?.();
    } catch (e) {
      setError(messageFor(e));
    }
  };
  const confirm = (title: string, message: string, onConfirm: () => void, label: string) =>
    Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: label, style: "destructive", onPress: onConfirm }]);

  const manageable = room.kind === "invite" && room.isOwner;
  const removable = (m: ChatRoomMember) => m.userId !== me && ((manageable) || (room.kind === "rdv" && room.canModerate && m.role !== "host"));

  const memberActions = (m: ChatRoomMember) => {
    const remove = {
      text: room.kind === "rdv" ? "Remove from room" : "Remove",
      style: "destructive" as const,
      onPress: () => confirm("Remove member?", room.kind === "rdv" ? `@${m.handle} will be blocked from this room even while their answer stays.` : `@${m.handle} will no longer see this room.`, () => void run(() => controller.removeMember(roomId, m.userId)), "Remove"),
    };
    Alert.alert(`@${m.handle}`, undefined, [
      ...(manageable ? [{ text: "Make owner", onPress: () => confirm("Transfer ownership?", `@${m.handle} becomes the owner and you become a member.`, () => void run(() => controller.transfer(roomId, m.userId)), "Transfer") }] : []),
      remove,
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  return (
    <Screen>
      <Text variant="large" numberOfLines={2}>{room.name}</Text>
      {room.description ? <Text muted>{room.description}</Text> : null}
      <Text variant="caption" muted>{KEPT}</Text>
      {error ? <Banner tone="error" text={error} /> : null}

      <Card>
        <Row title="Mute notifications" subtitle="You still see the unread count." right={<Toggle accessibilityLabel="Mute room" value={room.muted} onChange={(v) => void run(() => controller.setMuted(roomId, v))} />} />
      </Card>

      <Text variant="label" muted>{members.length === 1 ? "1 member" : `${members.length} members`}</Text>
      <Card>
        {members.map((m, i) => (
          <View key={m.userId}>
            {i > 0 ? <Divider /> : null}
            <Row
              testID={`member-${m.handle}`}
              title={`@${m.handle}${m.userId === me ? " (you)" : ""}`}
              subtitle={m.role === "member" ? undefined : ROLE_LABELS[m.role]}
              left={<Avatar handle={m.handle} path={m.avatarPath} />}
              right={removable(m) ? <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} /> : undefined}
              onPress={removable(m) ? () => memberActions(m) : undefined}
            />
          </View>
        ))}
      </Card>

      {room.kind === "crew" ? <Text variant="caption" muted>Members follow the crew. To remove someone, a crew owner or admin removes them from the crew.</Text> : null}
      {room.kind === "rdv" ? <Text variant="caption" muted>Members follow the Going and Maybe answers for this RDV.</Text> : null}

      {manageable ? (
        <>
          <Button testID="room-add" title={adding ? "Done" : "Add people"} variant="secondary" onPress={() => setAdding((v) => !v)} />
          {adding ? (
            candidates.length === 0 ? (
              <Text muted>Everyone you share a crew with is already here.</Text>
            ) : (
              <Card>
                {candidates.map((p, i) => (
                  <View key={p.userId}>
                    {i > 0 ? <Divider /> : null}
                    <Row
                      testID={`add-${p.handle}`}
                      title={`@${p.handle}`}
                      subtitle={p.crews.join(", ")}
                      left={<Avatar handle={p.handle} path={p.avatarPath} />}
                      right={<Ionicons name="add-circle-outline" size={22} color={colors.accentBright} />}
                      onPress={() => void run(() => controller.addMember(roomId, p.userId))}
                    />
                  </View>
                ))}
              </Card>
            )
          ) : null}
          <Button testID="room-delete" title="Delete room" variant="danger" onPress={() => confirm("Delete this room?", "The room and its messages are deleted for everyone.", () => void run(() => controller.deleteRoom(roomId), () => navigation.popToTop()), "Delete")} />
          <Text variant="caption" muted>Owners transfer ownership before leaving. Tap a member to do that.</Text>
        </>
      ) : room.kind === "invite" ? (
        <Button testID="room-leave" title="Leave room" variant="danger" onPress={() => confirm("Leave this room?", "You will stop seeing it. Ask the owner to add you back.", () => void run(() => controller.leave(roomId), () => navigation.popToTop()), "Leave")} />
      ) : null}
    </Screen>
  );
}
