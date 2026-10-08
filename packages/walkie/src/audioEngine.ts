import { resample } from "./mulaw";
import type { AudioEngine } from "./relayVoice";
import { FRAME_SAMPLES, SAMPLE_RATE } from "./wire";

// react-native-audio-api behind the AudioEngine contract. The native module loads on first use, so a build or a test that
// never joins a room does not need it. Nothing here has run against a real microphone or speaker in this repo's tests.
export function createAudioApiEngine(): AudioEngine {
  let api: any = null;
  let context: any = null;
  let queue: any = null;
  let recorder: any = null;
  const load = () => (api ??= require("react-native-audio-api"));

  return {
    async requestPermission() {
      const { AudioManager } = load();
      if ((await AudioManager.checkRecordingPermissions()) === "Granted") return true;
      return (await AudioManager.requestRecordingPermissions()) === "Granted";
    },
    async startSession() {
      const { AudioContext, AudioManager } = load();
      AudioManager.setAudioSessionOptions({
        iosCategory: "playAndRecord",
        iosMode: "default",
        iosOptions: ["defaultToSpeaker", "allowBluetoothHFP", "allowBluetoothA2DP"],
      });
      await AudioManager.setAudioSessionActivity(true);
      context = new AudioContext();
      queue = context.createBufferQueueSource();
      queue.connect(context.destination);
      queue.start();
    },
    async stopSession() {
      const { AudioManager } = load();
      try {
        queue?.stop();
      } catch {}
      queue = null;
      const old = context;
      context = null;
      await old?.close().catch(() => undefined);
      await AudioManager.setAudioSessionActivity(false).catch(() => undefined);
    },
    play(samples) {
      if (!context || !queue) return;
      const rate: number = context.sampleRate;
      const out = resample(samples, SAMPLE_RATE, rate);
      const buffer = context.createBuffer(1, out.length, rate);
      buffer.copyToChannel(out, 0);
      queue.enqueueBuffer(buffer);
    },
    async startCapture(onSamples) {
      const { AudioRecorder } = load();
      const next = new AudioRecorder();
      recorder = next;
      next.onAudioReady({ sampleRate: SAMPLE_RATE, bufferLength: FRAME_SAMPLES, channelCount: 1 }, (event: any) => {
        onSamples(new Float32Array(event.buffer.getChannelData(0)), event.buffer.sampleRate);
      });
      const result = await next.start();
      if (result?.status === "error") {
        recorder = null;
        throw new Error("microphone unavailable");
      }
    },
    async stopCapture() {
      const old = recorder;
      recorder = null;
      if (!old) return;
      old.clearOnAudioReady();
      await old.stop();
    },
  };
}
