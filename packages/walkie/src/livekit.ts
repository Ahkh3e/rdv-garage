import { PermissionsAndroid, Platform } from "react-native";
import type { Unsubscribe } from "@rdv/core/events";
import type { Voice, VoiceJoin, VoiceStatus } from "@rdv/core/voice";

const LEVEL_POLL_MS = 150;

// The one LiveKit-specific file (decision 0027). The native modules load on first use, so a build or a test that never
// joins a room does not need them. Nothing here has run against a real LiveKit server in this repo's tests.
export function createLiveKitVoice(): Voice {
  let rn: any = null;
  let lk: any = null;
  let room: any = null;
  let muted = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  const status = new Set<(s: VoiceStatus) => void>();
  const speakers = new Set<(i: string[]) => void>();
  const levels = new Set<(l: Record<string, number>) => void>();

  const load = () => {
    if (rn) return;
    rn = require("@livekit/react-native");
    rn.registerGlobals();
    lk = require("livekit-client");
  };
  const emit = (s: VoiceStatus) => status.forEach((fn) => fn(s));
  const applyMute = (publication: any) => publication?.setEnabled?.(!muted);
  const forEachRemoteAudio = (fn: (publication: any) => void) => {
    room?.remoteParticipants?.forEach((p: any) => p.audioTrackPublications?.forEach((pub: any) => fn(pub)));
  };

  const stopPolling = () => {
    if (poll) clearInterval(poll);
    poll = null;
  };

  return {
    async connect({ url, token }: VoiceJoin) {
      load();
      if (room) {
        stopPolling();
        await room.disconnect().catch(() => undefined);
      }
      await rn.AudioSession.configureAudio({
        android: { preferredOutputList: ["headset", "bluetooth", "speaker"], audioTypeOptions: rn.AndroidAudioTypePresets.communication },
        ios: { defaultOutput: "speaker" },
      });
      await rn.AudioSession.startAudioSession();
      const next = new lk.Room({
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        publishDefaults: { dtx: true },
      });
      room = next;
      next
        .on(lk.RoomEvent.Reconnecting, () => emit("reconnecting"))
        .on(lk.RoomEvent.Reconnected, () => emit("connected"))
        .on(lk.RoomEvent.Disconnected, () => {
          if (room === next) emit("disconnected");
        })
        .on(lk.RoomEvent.ActiveSpeakersChanged, (active: any[]) => speakers.forEach((fn) => fn(active.map((p) => p.identity))))
        .on(lk.RoomEvent.TrackSubscribed, (_track: unknown, publication: any) => applyMute(publication))
        .on(lk.RoomEvent.TrackPublished, (publication: any) => applyMute(publication));
      emit("connecting");
      await next.connect(url, token, { autoSubscribe: true });
      emit("connected");
      forEachRemoteAudio(applyMute);
      poll = setInterval(() => {
        const out: Record<string, number> = {};
        next.remoteParticipants.forEach((p: any) => (out[p.identity] = p.audioLevel ?? 0));
        out[next.localParticipant.identity] = next.localParticipant.audioLevel ?? 0;
        levels.forEach((fn) => fn(out));
      }, LEVEL_POLL_MS);
    },
    async disconnect() {
      stopPolling();
      const current = room;
      room = null;
      if (!current) return;
      await current.disconnect().catch(() => undefined);
      await rn?.AudioSession.stopAudioSession().catch(() => undefined);
    },
    // Opening publishes the microphone; closing unpublishes it, so nothing stays published between presses.
    async setMicOpen(open: boolean) {
      if (!room) throw new Error("not connected");
      if (open) {
        await room.localParticipant.setMicrophoneEnabled(true);
        return;
      }
      const publication = room.localParticipant.getTrackPublication(lk.Track.Source.Microphone);
      if (publication?.track) await room.localParticipant.unpublishTrack(publication.track, true);
    },
    async requestMicPermission() {
      if (Platform.OS === "android") {
        return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) === PermissionsAndroid.RESULTS.GRANTED;
      }
      try {
        const { mediaDevices } = require("@livekit/react-native-webrtc");
        const stream = await mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t: any) => t.stop());
        return true;
      } catch {
        return false;
      }
    },
    setSoundMuted(next: boolean) {
      muted = next;
      forEachRemoteAudio(applyMute);
    },
    identity: () => room?.localParticipant?.identity || null,
    onStatus: (fn): Unsubscribe => (status.add(fn), () => status.delete(fn)),
    onSpeakers: (fn): Unsubscribe => (speakers.add(fn), () => speakers.delete(fn)),
    onLevels: (fn): Unsubscribe => (levels.add(fn), () => levels.delete(fn)),
  };
}
