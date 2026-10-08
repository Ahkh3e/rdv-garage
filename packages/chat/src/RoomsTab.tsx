import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { Button, Card, Divider, Empty, Screen, Text, colors, crewStyle, messageFor, useCrewState, useSession, useStore } from "@rdv/core";
import { CHAT_NEW_ROOM_ROUTE } from "@rdv/core/chat";
import { useController } from "./context";
import { previewLine, shortAge, type Room } from "./model";
import { UnreadBadge } from "./ui";

const ICONS = { invite: "lock", rdv: "calendar" } as const;

export function RoomsTab({ navigation }: { navigation: any }) {
  const controller = useController();
  const { rooms, loaded } = useStore(controller.state);
  const session = useSession();
  const crews = useCrewState().crews;
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const me = session.status === "signedIn" ? session.userId : null;

  const refresh = useCallback(async () => {
    try {
      await controller.refresh();
      setError(null);
    } catch (e) {
      setError(messageFor(e));
    }
  }, [controller]);

  useFocusEffect(
    useCallback(() => {
      void controller.ensureNotificationPermission();
      void refresh();
      const timer = setInterval(() => void refresh(), 30000);
      return () => clearInterval(timer);
    }, [controller, refresh]),
  );

  const now = Date.now();
  const crewRooms = rooms.filter((r) => r.kind === "crew");
  const others = rooms.filter((r) => r.kind !== "crew");
  const create = <Button title="New room" testID="rooms-new" onPress={() => navigation.navigate(CHAT_NEW_ROOM_ROUTE)} />;

  const renderRow = (room: Room, i: number) => {
    const crew = room.crewId ? crews.find((c) => c.id === room.crewId) : undefined;
    return (
      <View key={room.id}>
        {i > 0 ? <Divider /> : null}
        <Pressable
          testID={`room-${room.id}`}
          accessibilityRole="button"
          onPress={() => controller.open(room.id)}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.press }]}
        >
          {room.kind === "crew" ? (
            <View style={[styles.dot, { backgroundColor: crew ? crewStyle(crew.styleIndex).tint : colors.subtle }]} />
          ) : (
            <Feather name={ICONS[room.kind as "invite" | "rdv"]} size={16} color={colors.muted} />
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline" numberOfLines={1}>{room.name}</Text>
            <Text variant="caption" muted numberOfLines={1} testID={`room-last-${room.id}`}>{room.closed ? `Closed  ·  ${previewLine(room, me)}` : previewLine(room, me)}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            {room.lastMessage ? <Text variant="caption" muted>{shortAge(room.lastMessage.createdAt, now)}</Text> : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {room.muted ? <Feather name="bell-off" size={13} color={colors.subtle} /> : null}
              <UnreadBadge count={room.unread} testID={`unread-${room.id}`} />
            </View>
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }}>
      <View style={{ gap: 4 }}>
        <Text variant="large">Rooms</Text>
        <Text variant="body" muted>Talk with your crews and friends. Messages are kept for 7 days.</Text>
      </View>
      {error ? <Text color={colors.danger}>{error}</Text> : null}
      {loaded && rooms.length === 0 ? (
        <Empty overline="Rooms" title="No rooms yet" body="Every crew has a room once you join one. Start a private room with people from your crews." action={create} />
      ) : (
        <>
          {crewRooms.length > 0 ? <Text variant="label" muted>Crews</Text> : null}
          {crewRooms.length > 0 ? <Card>{crewRooms.map(renderRow)}</Card> : null}
          {others.length > 0 ? <Text variant="label" muted>Other rooms</Text> : null}
          {others.length > 0 ? <Card>{others.map(renderRow)}</Card> : null}
          {loaded ? create : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, minHeight: 72 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
