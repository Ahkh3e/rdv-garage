import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Alert, AppState, FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import {
  Avatar, Banner, Button, DISCLAIMER_ROOM, Empty, Screen, Slot, Spinner, Text, colors, fonts, messageFor, radii, useSession, useStore,
} from "@rdv/core";
import { CHAT_COMPOSER_ACTIONS_SLOT, CHAT_ROOM_INFO_ROUTE, CHAT_ROOM_STATUS_SLOT, type ChatRoomContext, type ChatRoomMember } from "@rdv/core/chat";
import { useController } from "./context";
import { MAX_BODY, canDelete, canSend, clockTime, showsSender, type Message } from "./model";

const EMPTY: Message[] = [];

export function RoomScreen({ navigation, route }: { navigation: any; route: { params: { roomId: string } } }) {
  const { roomId } = route.params;
  const controller = useController();
  const chat = useStore(controller.state);
  const session = useSession();
  const me = session.status === "signedIn" ? session.userId : null;
  const room = chat.rooms.find((r) => r.id === roomId);
  const messages = chat.messages[roomId] ?? EMPTY;
  const [ready, setReady] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState<ChatRoomMember[]>([]);
  const memberCount = room?.memberCount ?? 0;

  useEffect(() => {
    let alive = true;
    setReady(false);
    (async () => {
      try {
        if (!controller.room(roomId)) await controller.refresh();
        const hasMore = await controller.loadHistory(roomId);
        if (alive) setMore(hasMore);
      } catch (e) {
        if (alive) setError(messageFor(e));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [controller, roomId]);

  useFocusEffect(
    useCallback(() => {
      const apply = (appState: string) => controller.setViewing(appState === "active" ? roomId : null);
      apply(AppState.currentState);
      const subscription = AppState.addEventListener("change", apply);
      return () => {
        subscription.remove();
        controller.setViewing(null);
      };
    }, [controller, roomId]),
  );

  useEffect(() => {
    if (!room) return;
    let alive = true;
    const load = () => controller.members(roomId).then((rows) => alive && setMembers(rows)).catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [controller, roomId, room?.id, memberCount]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: room?.name ?? "Room",
      headerRight: room
        ? () => (
            <Pressable testID="room-info" accessibilityLabel="Room info" hitSlop={12} onPress={() => navigation.navigate(CHAT_ROOM_INFO_ROUTE, { roomId })}>
              <Feather name="info" size={20} color={colors.text} />
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, room?.name, !!room, roomId]);

  const context: ChatRoomContext | null = useMemo(
    () =>
      room
        ? { roomId, kind: room.kind, name: room.name, crewId: room.crewId, rdvId: room.rdvId, closed: room.closed, canModerate: room.canModerate, members }
        : null,
    [room, roomId, members],
  );

  const data = useMemo(() => [...messages].reverse(), [messages]);

  const submit = async () => {
    const body = draft;
    if (!canSend(body) || sending) return;
    setSending(true);
    setError(null);
    try {
      await controller.send(roomId, body);
      setDraft("");
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setSending(false);
    }
  };

  const loadOlder = async () => {
    if (!more || messages.length === 0) return;
    try {
      setMore(await controller.loadOlder(roomId));
    } catch {
      setMore(false);
    }
  };

  const confirmDelete = (message: Message) =>
    Alert.alert("Delete this message?", "It disappears for everyone in the room.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void controller.remove(roomId, message.id).catch((e) => Alert.alert("Couldn't delete", messageFor(e))),
      },
    ]);

  if (!ready && !room) return <Spinner />;
  if (!room || !context) {
    return (
      <Screen>
        <Empty title="This room is gone" body="You were removed from it, or it was deleted." action={<Button title="Back" variant="secondary" onPress={() => navigation.goBack()} />} />
      </Screen>
    );
  }

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const mine = item.senderId === me;
    const header = showsSender(data[index + 1], item);
    const deletable = canDelete(item, room, me);
    return (
      <View style={[styles.line, mine ? styles.lineMine : styles.lineTheirs]}>
        {!mine ? <View style={{ width: 32 }}>{header ? <Avatar handle={item.handle} path={item.avatarPath} size={32} /> : null}</View> : null}
        <Pressable
          testID={`msg-${item.id}`}
          onLongPress={deletable ? () => confirmDelete(item) : undefined}
          style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
        >
          {header ? (
            <Text variant="caption" muted>{mine ? "You" : `@${item.handle}`}  ·  {clockTime(item.createdAt)}</Text>
          ) : null}
          <Text variant="body">{item.body}</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <Screen scroll={false} padded={false} topInset={false}>
      <FlatList
        testID="message-list"
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ padding: 16, gap: 4 }}
        ListEmptyComponent={ready ? <Text testID="room-empty" muted style={styles.empty}>No messages yet. Say something.</Text> : null}
        ListFooterComponent={<Text variant="caption" muted style={styles.disclaimer}>{DISCLAIMER_ROOM}</Text>}
      />
      {error ? <Banner tone="error" text={error} /> : null}
      <Slot name={CHAT_ROOM_STATUS_SLOT} room={context} />
      {room.closed ? (
        <View style={styles.composer}>
          <Text testID="room-closed" muted style={{ flex: 1 }}>This room is closed. The RDV has ended.</Text>
        </View>
      ) : (
        <View style={styles.composer}>
          <TextInput
            testID="composer-input"
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={colors.subtle}
            selectionColor={colors.accent}
            keyboardAppearance="dark"
            multiline
            maxLength={MAX_BODY}
            style={styles.input}
          />
          <Pressable
            testID="composer-send"
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend(draft) || sending }}
            onPress={submit}
            style={[styles.send, (!canSend(draft) || sending) && { opacity: 0.4 }]}
          >
            <Feather name="arrow-up" size={20} color={colors.onAccent} />
          </Pressable>
          {/* Reserved for the walkie-talkie Talk button, which that module adds through this slot. */}
          <View testID="composer-actions" style={styles.actions}>
            <Slot name={CHAT_COMPOSER_ACTIONS_SLOT} room={context} />
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  lineMine: { justifyContent: "flex-end" },
  lineTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, borderCurve: "continuous", gap: 2 },
  bubbleMine: { backgroundColor: colors.accentSoft },
  bubbleTheirs: { backgroundColor: colors.raised },
  empty: { textAlign: "center", paddingVertical: 32, transform: [{ scaleY: -1 }] },
  disclaimer: { textAlign: "center", paddingVertical: 12, paddingHorizontal: 12 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, backgroundColor: colors.background },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: radii.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.fill, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, color: colors.text, fontFamily: fonts.regular, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
});
