// livekit-client logs these at error level when a socket closes the way it is meant to (leaving, a kick, a network
// change). They are not failures: the controller rejoins on its own.
export const EXPECTED_LIVEKIT_LOGS: RegExp[] = [
  /error reading from signal stream/i,
  /ws closed unexpectedly/i,
  /ping timeout triggered/i,
  /websocket closed/i,
];

export const isExpectedLiveKitLog = (message: string) => EXPECTED_LIVEKIT_LOGS.some((p) => p.test(message));
