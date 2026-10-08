import { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "@rdv/core";
import type { ChatRoomSlotProps } from "@rdv/core/chat";
import { useStore } from "@rdv/core/store";
import { useKit } from "./context";
import { canTalk, voiceOffLine } from "./lines";

// Rendered in the room's composer. Mounting it is entering the room's channel and unmounting it is leaving, so this is
// also where the channel is joined.
export function TalkButton({ room }: ChatRoomSlotProps) {
  const { controller } = useKit();
  const s = useStore(controller.state);
  useEffect(() => controller.acquire(room.roomId, room.name), [controller, room.roomId, room.name]);
  const off = s.phase === "listening" && !s.canPublish;
  const enabled = canTalk(s);
  return (
    <Pressable
      testID="talk-button"
      accessibilityRole="button"
      accessibilityLabel={off ? voiceOffLine(s.voiceOffCrews) : s.talking ? "On the air. Release to stop" : "Hold to talk"}
      accessibilityState={{ disabled: !enabled, busy: s.talking }}
      disabled={!enabled && !s.talking}
      onPressIn={() => void controller.press()}
      onPressOut={() => void controller.release()}
      hitSlop={6}
      style={[styles.button, s.talking && styles.live, !enabled && !s.talking && styles.off]}
    >
      <Feather name={off ? "mic-off" : "mic"} size={20} color={s.talking ? colors.onAccent : enabled ? colors.text : colors.subtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  live: { backgroundColor: colors.danger, borderColor: colors.danger },
  off: { opacity: 0.5 },
});
