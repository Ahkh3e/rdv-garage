import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Avatar, Button, CarIcon, DISCLAIMER_ROOM, Text, colors, radii } from "@rdv/core";
import type { ChatRoomMember, ChatRoomSlotProps } from "@rdv/core/chat";
import { useStore } from "@rdv/core/store";
import { useKit } from "./context";
import { level, statusLine } from "./lines";

function Meter({ userId }: { userId: string }) {
  const { controller } = useKit();
  const levels = useStore(controller.levels);
  return (
    <View style={styles.meter}>
      <View testID={`meter-${userId}`} style={[styles.meterFill, { width: `${Math.round(level(levels[userId]) * 100)}%` }]} />
    </View>
  );
}

function Talker({ member, userId }: { member: ChatRoomMember | undefined; userId: string }) {
  return (
    <View testID={`talker-${userId}`} style={styles.talker}>
      <Avatar handle={member?.handle ?? "?"} path={member?.avatarPath ?? null} size={28} />
      <Text variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>{member ? `@${member.handle}` : "A member"}</Text>
      {member ? <CarIcon icon={member.carIcon} size={20} /> : null}
      <Meter userId={userId} />
    </View>
  );
}

// Above the composer: the one-time safety line, who is talking, the connection state, and the room sound control.
export function WalkieStatus({ room }: ChatRoomSlotProps) {
  const { controller, disclaimerSeen, openSettings } = useKit();
  const s = useStore(controller.state);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    disclaimerSeen.get().then((seen) => alive && setShowDisclaimer(!seen)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [disclaimerSeen]);

  const memberKey = room.members.map((m) => m.userId).sort().join(",");
  const lastMembers = useRef<string | null>(null);
  useEffect(() => {
    if (lastMembers.current !== null && lastMembers.current !== memberKey) controller.rosterChanged();
    if (memberKey) lastMembers.current = memberKey;
  }, [controller, memberKey]);

  if (room.closed || s.roomId !== room.roomId) return null;
  const byId = new Map(room.members.map((m) => [m.userId, m]));
  const speakerIds = s.audible.filter((id) => byId.has(id));
  const presentIds = s.present.filter((id) => byId.has(id));
  const line = statusLine(s);
  const dismiss = () => {
    setShowDisclaimer(false);
    void disclaimerSeen.set().catch(() => undefined);
  };

  return (
    <View testID="walkie-status" style={styles.wrap}>
      {showDisclaimer ? (
        <View testID="walkie-disclaimer" style={styles.disclaimer}>
          <Text variant="caption" style={{ flex: 1 }}>{DISCLAIMER_ROOM}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Got it" hitSlop={10} onPress={dismiss}>
            <Text variant="caption" style={{ color: colors.accentBright }}>Got it</Text>
          </Pressable>
        </View>
      ) : null}
      {s.talking ? (
        <View testID="on-the-air-self" style={styles.onAir}>
          <View style={styles.dot} />
          <Text variant="headline">On the air</Text>
        </View>
      ) : null}
      {speakerIds.map((id) => (
        <View key={id} style={styles.onAirRow}>
          <View style={styles.dot} />
          <Text variant="caption" muted>On the air</Text>
          <Talker member={byId.get(id)} userId={id} />
        </View>
      ))}
      <View style={styles.bar}>
        <Pressable testID="walkie-people" accessibilityRole="button" onPress={() => setListOpen((v) => !v)} style={styles.people}>
          <Feather name="radio" size={14} color={colors.muted} />
          <Text variant="caption" muted>{s.phase === "listening" ? `${presentIds.length + 1} in the channel` : "Voice"}</Text>
        </Pressable>
        <Pressable
          testID="walkie-mute"
          accessibilityRole="button"
          accessibilityLabel={s.soundMuted ? "Unmute room sound" : "Mute room sound"}
          hitSlop={10}
          onPress={() => controller.setSoundMuted(!s.soundMuted)}
        >
          <Feather name={s.soundMuted ? "volume-x" : "volume-2"} size={18} color={s.soundMuted ? colors.danger : colors.muted} />
        </Pressable>
        {s.phase === "listening" || s.phase === "reconnecting" ? (
          <Pressable testID="walkie-leave" accessibilityRole="button" accessibilityLabel="Leave voice channel" hitSlop={10} onPress={() => void controller.leaveChannel()}>
            <Text variant="caption" style={{ color: colors.danger }}>Leave</Text>
          </Pressable>
        ) : null}
      </View>
      {listOpen ? (
        <Text testID="walkie-people-list" variant="caption" muted>
          {["you", ...presentIds.map((id) => `@${byId.get(id)!.handle}`)].join(", ")}
        </Text>
      ) : null}
      {line ? (
        <View testID="walkie-line" style={styles.line}>
          <Text variant="caption" style={{ color: line.tone === "warn" ? colors.danger : colors.muted, flex: 1 }}>{line.text}</Text>
          {s.mic === "denied" && s.phase === "listening" ? (
            <Pressable accessibilityRole="button" hitSlop={10} onPress={openSettings}><Text variant="caption" style={{ color: colors.accentBright }}>Settings</Text></Pressable>
          ) : null}
        </View>
      ) : null}
      {s.phase === "left" ? <Button title="Rejoin voice" variant="secondary" testID="walkie-rejoin" onPress={() => controller.rejoin()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingVertical: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, backgroundColor: colors.background },
  disclaimer: { flexDirection: "row", gap: 10, alignItems: "center", padding: 10, borderRadius: radii.md, backgroundColor: colors.s1 },
  onAir: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radii.md, backgroundColor: "rgba(255,69,58,0.14)" },
  onAirRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  talker: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  meter: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.fill, overflow: "hidden", minWidth: 40 },
  meterFill: { height: 4, backgroundColor: colors.accentBright },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  people: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
});
