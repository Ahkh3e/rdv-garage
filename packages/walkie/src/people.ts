export const SPEAKER_TTL_MS = 65_000;
export const PRESENT_TTL_MS = 75_000;

export interface Person {
  identity: string | null;
  at: number;
}

export interface People {
  speakers: Record<string, Person>;
  present: Record<string, Person>;
}

export type PeopleEvent =
  | { type: "start" | "stop" | "join" | "here" | "leave"; userId: string; identity?: string | null; at: number }
  | { type: "expire"; at: number }
  | { type: "reset" };

export const emptyPeople: People = { speakers: {}, present: {} };

const without = <T>(map: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _gone, ...rest } = map;
  return rest;
};

// Who is in the channel and who is talking, from the start, stop and presence events members send on walkie:<room_id>.
// A talker whose stop never arrives drops out after SPEAKER_TTL_MS, a little over the 60 second microphone limit.
export function reducePeople(state: People, event: PeopleEvent): People {
  switch (event.type) {
    case "reset":
      return emptyPeople;
    case "expire": {
      const keep = (map: Record<string, Person>, ttl: number) =>
        Object.fromEntries(Object.entries(map).filter(([, p]) => event.at - p.at < ttl));
      const speakers = keep(state.speakers, SPEAKER_TTL_MS);
      const present = keep(state.present, PRESENT_TTL_MS);
      const same = Object.keys(speakers).length === Object.keys(state.speakers).length && Object.keys(present).length === Object.keys(state.present).length;
      return same ? state : { speakers, present };
    }
    case "leave":
      return { speakers: without(state.speakers, event.userId), present: without(state.present, event.userId) };
    case "stop":
      return state.speakers[event.userId] ? { ...state, speakers: without(state.speakers, event.userId) } : state;
    case "start": {
      const person = { identity: event.identity ?? null, at: event.at };
      return { speakers: { ...state.speakers, [event.userId]: person }, present: { ...state.present, [event.userId]: person } };
    }
    default:
      return { ...state, present: { ...state.present, [event.userId]: { identity: event.identity ?? state.present[event.userId]?.identity ?? null, at: event.at } } };
  }
}
