const TaskManager = require("expo-task-manager");
const Location = require("expo-location");
import "@rdv/live-location";
import { setFixSink } from "../../../packages/live-location/src/task";

// Captured at load: the task is defined when the module is imported, before any test clears the mock history.
const taskExecutor = TaskManager.defineTask.mock.calls.find((c: any[]) => c[0] === "rdv-live-location")[1];
const executor = () => taskExecutor;

describe("background location task", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes fixes to the live session", async () => {
    const seen: any[] = [];
    setFixSink((fix) => seen.push(fix));
    await executor()({ data: { locations: [{ coords: { latitude: 1, longitude: 2, speed: 5, heading: 90, accuracy: 4 }, timestamp: 123 }] }, error: null });
    expect(seen).toEqual([{ lat: 1, lng: 2, speedMs: 5, heading: 90, accuracy: 4, ts: 123 }]);
    setFixSink(null);
  });

  it("maps unknown speed and heading to null", async () => {
    const seen: any[] = [];
    setFixSink((fix) => seen.push(fix));
    await executor()({ data: { locations: [{ coords: { latitude: 1, longitude: 2, speed: -1, heading: -1, accuracy: null }, timestamp: 1 }] }, error: null });
    expect(seen[0]).toMatchObject({ speedMs: null, heading: null, accuracy: null });
    setFixSink(null);
  });

  it("stops the location updates when the OS wakes the app with no live session in memory", async () => {
    setFixSink(null);
    Location.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(true);
    await executor()({ data: { locations: [{ coords: { latitude: 1, longitude: 2, speed: 5, heading: 90, accuracy: 4 }, timestamp: 1 }] }, error: null });
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith("rdv-live-location");
  });
});
