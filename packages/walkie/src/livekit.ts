import { LogBox, PermissionsAndroid, Platform } from "react-native";
import { EXPECTED_LIVEKIT_LOGS } from "./quiet";
import type { Unsubscribe } from "@rdv/core/events";
import type { Voice, VoiceJoin, VoiceStatus } from "@rdv/core/voice";

const LEVEL_POLL_MS = 150;

export interface LiveKitModules {
  rn: any;
  lk: any;
}

// The one LiveKit-specific file (decision 0027). The native modules load on first use, so a build or a test that never
// joins a room does not need them. Nothing here has run against a real LiveKit server in this repo's tests.
export function createLiveKitVoice(modules?: LiveKitModules): Voice {
  let rn: any = modules?.rn ?? null;
  let lk: any = modules?.lk ?? null;
  let room: any = null;
  let muted = false;
  let epoch = 0;
  let attempts = 0;
  let poll: ReturnType<typeof setInterval> | null = null;
  const status = new Set<(s: VoiceStatus) => void>();
  const speakers = new Set<(i: string[]) => void>();
  const participants = new Set<(i: string[]) => void>();
  const levels = new Set<(l: Record<string, number>) => void>();

  const load = () => {
    if (rn) return;
    rn = require("@livekit/react-native");
    rn.registerGlobals();
    lk = require("livekit-client");
    lk.setLogLevel?.(lk.LogLevel?.error ?? "error");
    LogBox?.ignoreLogs?.(EXPECTED_LIVEKIT_LOGS);
  };
  const emit = (s: VoiceStatus) => status.forEach((fn) => fn(s));
  const applyMute = (publication: any) => publication?.setEnabled?.(!muted);
  const forEachRemoteAudio = (fn: (publication: any) => void) => {
    room?.remoteParticipants?.forEach((p: any) => p.audioTrackPublications?.forEach((pub: any) => fn(pub)));
  };
  const announceParticipants = (current: any) => {
    if (room !== current) return;
    const ids: string[] = [];
    current.remoteParticipants.forEach((p: any) => ids.push(p.identity));
    participants.forEach((fn) => fn(ids));
  };

  const stopPolling = () => {
    if (poll) clearInterval(poll);
    poll = null;
  };

  // Ends one connect attempt that was superseded or failed: nothing it started stays alive.
  const abandon = async (next: any) => {
    if (room === next) {
      room = null;
      stopPolling();
    }
    await next?.disconnect().catch(() => undefined);
    if (!room && attempts <= 1) await rn?.AudioSession.stopAudioSession().catch(() => undefined);
  };

  return {
    async connect({ url, token }: VoiceJoin) {
      load();
      const my = ++epoch;
      attempts++;
      const stale = () => my !== epoch;
      let next: any = null;
      try {
        if (room) {
          stopPolling();
          const old = room;
          room = null;
          await old.disconnect().catch(() => undefined);
        }
        if (stale()) return await abandon(null);
        await rn.AudioSession.configureAudio({
          android: { preferredOutputList: ["headset", "bluetooth", "speaker"], audioTypeOptions: rn.AndroidAudioTypePresets.communication },
          ios: { defaultOutput: "speaker" },
        });
        if (stale()) return await abandon(null);
        await rn.AudioSession.startAudioSession();
        if (stale()) return await abandon(null);
        const created = new lk.Room({
          adaptiveStream: false,
          dynacast: false,
          audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          publishDefaults: { dtx: true },
        });
        next = created;
        room = created;
        created
          .on(lk.RoomEvent.Reconnecting, () => emit("reconnecting"))
          .on(lk.RoomEvent.Reconnected, () => emit("connected"))
          .on(lk.RoomEvent.Disconnected, () => {
            if (room === created) emit("disconnected");
          })
          .on(lk.RoomEvent.ActiveSpeakersChanged, (active: any[]) => {
            if (room === created) speakers.forEach((fn) => fn(active.map((p) => p.identity)));
          })
          .on(lk.RoomEvent.ParticipantConnected, () => announceParticipants(created))
          .on(lk.RoomEvent.ParticipantDisconnected, () => announceParticipants(created))
          .on(lk.RoomEvent.TrackSubscribed, (_track: unknown, publication: any) => applyMute(publication))
          .on(lk.RoomEvent.TrackPublished, (publication: any) => applyMute(publication));
        emit("connecting");
        await created.connect(url, token, { autoSubscribe: true });
        if (stale()) return await abandon(created);
        emit("connected");
        forEachRemoteAudio(applyMute);
        announceParticipants(created);
        poll = setInterval(() => {
          const out: Record<string, number> = {};
          created.remoteParticipants.forEach((p: any) => (out[p.identity] = p.audioLevel ?? 0));
          out[created.localParticipant.identity] = created.localParticipant.audioLevel ?? 0;
          levels.forEach((fn) => fn(out));
        }, LEVEL_POLL_MS);
      } catch (e) {
        await abandon(next);
        throw e;
      } finally {
        attempts--;
      }
    },
    async disconnect() {
      epoch++;
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
    onParticipants: (fn): Unsubscribe => (participants.add(fn), () => participants.delete(fn)),
    onLevels: (fn): Unsubscribe => (levels.add(fn), () => levels.delete(fn)),
  };
}
