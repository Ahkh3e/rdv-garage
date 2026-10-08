import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Banner, Button, Card, Text, colors, messageFor, useStore } from "@rdv/core";
import type { CrewDetailSlotProps, RdvDetailSlotProps } from "@rdv/core/chat";
import { useController } from "./context";
import { UnreadBadge } from "./ui";

export function CrewRoomLink({ crewId }: CrewDetailSlotProps) {
  const controller = useController();
  const room = useStore(controller.state).rooms.find((r) => r.crewId === crewId);
  useEffect(() => {
    if (!controller.state.get().loaded) void controller.refresh().catch(() => undefined);
  }, [controller]);
  if (!room) return null;
  return (
    <Card>
      <Pressable testID="crew-room-open" accessibilityRole="button" onPress={() => controller.open(room.id)} style={styles.link}>
        <Feather name="message-circle" size={18} color={colors.muted} />
        <View style={{ flex: 1 }}>
          <Text variant="headline">Crew room</Text>
          <Text variant="caption" muted>Chat with the whole crew</Text>
        </View>
        <UnreadBadge count={room.unread} />
        <Feather name="chevron-right" size={18} color={colors.subtle} />
      </Pressable>
    </Card>
  );
}

export function RdvRoomLink({ rdvId, isHost, ended, cancelled }: RdvDetailSlotProps) {
  const controller = useController();
  const room = useStore(controller.state).rooms.find((r) => r.rdvId === rdvId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!controller.state.get().loaded) void controller.refresh().catch(() => undefined);
  }, [controller]);

  if (room) {
    return (
      <Button testID="rdv-room-open" title={room.unread > 0 ? `Open room  ·  ${room.unread} new` : "Open room"} variant="secondary" onPress={() => controller.open(room.id)} />
    );
  }
  if (!isHost || ended || cancelled) return null;
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      controller.open(await controller.openRdvRoom(rdvId));
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button testID="rdv-room-create" title="Open a room for this RDV" variant="secondary" loading={busy} onPress={open} />
      {error ? <Banner tone="error" text={error} /> : null}
    </>
  );
}

const styles = StyleSheet.create({ link: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 64 } });
