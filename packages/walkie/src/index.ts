import { Alert, AppState, Linking } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { Module, Shell } from "@rdv/core";
import { DISCLAIMER_ROOM } from "@rdv/core/legal";
import { CHAT_COMPOSER_ACTIONS_SLOT, CHAT_ROOM_STATUS_SLOT } from "@rdv/core/chat";
import type { Voice } from "@rdv/core/voice";
import { createWalkie, type RoomIndicator, type WalkieController } from "./controller";
import { setKit } from "./context";
import { createRoomIndicator } from "./indicator";
import { createAudioApiEngine } from "./audioEngine";
import { createRelayVoice } from "./relayVoice";
import { WalkieStatus } from "./WalkieStatus";
import { MIC_EXPLANATION } from "./lines";
import { TalkButton } from "./Talk";

export { createWalkie, type WalkieController, type WalkieState, type RoomIndicator } from "./controller";
export { createTalkTimer, TALK_LIMIT_MS } from "./talkTimer";

const DISCLAIMER_KEY = "rdv.walkie.disclaimer.seen";

export interface WalkieOverrides {
  voice?: Voice;
  indicator?: RoomIndicator & { start?(): () => void };
  explainMic?: () => Promise<boolean>;
  disclaimerSeen?: { get(): Promise<boolean>; set(): Promise<void> };
  appState?: () => string;
}

const explainMic = () =>
  new Promise<boolean>((resolve) =>
    Alert.alert("Use your microphone?", `${MIC_EXPLANATION}\n\n${DISCLAIMER_ROOM}`, [
      { text: "Not now", style: "cancel", onPress: () => resolve(false) },
      { text: "Continue", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );

const storedDisclaimer = {
  get: async () => (await SecureStore.getItemAsync(DISCLAIMER_KEY).catch(() => null)) === "1",
  set: async () => void (await SecureStore.setItemAsync(DISCLAIMER_KEY, "1").catch(() => undefined)),
};

// The walkie-talkie channel of every chat room (docs/features/walkie-talkie.md). It fills the chat module's two room
// slots and talks to chat only through them, so it needs no import of the chat package.
export function createWalkieModule(overrides: WalkieOverrides = {}): Module {
  return {
    id: "walkie",
    register(shell: Shell) {
      shell.addFlag("walkie", true);
      if (!shell.isEnabled("walkie")) return undefined;
      const holder: { walkie: WalkieController | null } = { walkie: null };
      const indicator = overrides.indicator ?? createRoomIndicator(() => void holder.walkie?.leaveChannel());
      const walkie = createWalkie({
        backend: shell.backend,
        voice: overrides.voice ?? createRelayVoice({ engine: createAudioApiEngine() }),
        userId: () => shell.backend.userId(),
        indicator,
        explainMic: overrides.explainMic ?? explainMic,
      });
      holder.walkie = walkie;
      setKit(shell, { controller: walkie, disclaimerSeen: overrides.disclaimerSeen ?? storedDisclaimer, openSettings: () => void Linking.openSettings().catch(() => undefined) });
      shell.addSlot(CHAT_COMPOSER_ACTIONS_SLOT, TalkButton, 10);
      shell.addSlot(CHAT_ROOM_STATUS_SLOT, WalkieStatus, 10);

      const offs: (() => void)[] = [];
      const stopIndicator = indicator.start?.();
      if (stopIndicator) offs.push(stopIndicator);
      // Talking needs the app open: the microphone closes the moment the app leaves the foreground. Listening goes on.
      const sub = AppState.addEventListener("change", (state) => {
        if (state !== "active") void walkie.release();
      });
      offs.push(() => sub.remove());
      const leave = () => walkie.dispose();
      for (const type of ["account.suspended", "account.deleted"] as const) offs.push(shell.events.on(type, leave));
      offs.push(shell.session.subscribe(() => shell.session.get().status !== "signedIn" && leave()));
      return () => offs.forEach((off) => off());
    },
  };
}

export const walkie: Module = createWalkieModule();
