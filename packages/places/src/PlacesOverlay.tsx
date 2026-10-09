import { useEffect, useRef, useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Glass, GlassButton, MAP_GAP, MAP_ROW, MAP_SIDE, colors, radii, useMapTops, useShell, useStore, type Place } from "@rdv/core";
import { PinCard, PlaceCard } from "./Cards";
import { useController } from "./context";
import { DropPinSheet } from "./DropPinSheet";
import { NearbyPanel } from "./NearbyPanel";
import { SearchField, SearchResults, useSearch } from "./SearchResults";
import { queryReady } from "./validation";

const MIN_PANEL = 120;

export function PlacesOverlay() {
  const shell = useShell();
  const controller = useController();
  const search = useSearch();
  const { selection, pins } = useStore(controller.state);
  const [panel, setPanel] = useState<"search" | "nearby" | null>(null);
  const [now, setNow] = useState(Date.now());
  const tops = useMapTops();
  const [area, setArea] = useState<number | null>(null);

  useEffect(() => controller.start(), [controller]);
  useEffect(() => shell.mapBridge.onLongPress((point) => controller.startDrop(point)), [shell, controller]);
  useEffect(() => shell.mapBridge.onPress(() => setPanel(null)), [shell]);
  useEffect(() => {
    if (panel) shell.mapBridge.requestAtLeastHalf();
  }, [shell, panel]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Blur fires before a press on a Recent row lands, so the check waits a beat and reads the query then.
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
  };
  useEffect(() => cancelIdle, []);
  const closeIfIdle = () => {
    cancelIdle();
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      if (!queryReady(search.state.get().query)) setPanel((p) => (p === "search" ? null : p));
    }, 250);
  };

  const choose = (place: Place) => {
    Keyboard.dismiss();
    setPanel(null);
    search.reset();
    controller.openPlace(place);
  };

  const room = area === null ? Infinity : area - tops.below - MAP_GAP;
  const pin = selection?.kind === "pin" ? pins.find((p) => p.id === selection.pinId) : null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={(e) => setArea(e.nativeEvent.layout.height)}>
      <View style={[styles.top, { top: tops.search }]} pointerEvents="box-none">
        <Glass kind="control" style={styles.search}>
          <SearchField search={search} onFocus={() => { cancelIdle(); setPanel("search"); }} onBlur={closeIfIdle} onClear={() => setPanel(null)} />
        </Glass>
        <GlassButton testID="places-nearby" label="Nearby" onPress={() => { Keyboard.dismiss(); setPanel((p) => (p === "nearby" ? null : "nearby")); }}>
          <Feather name="compass" size={19} color={panel === "nearby" ? colors.accentBright : colors.text} />
        </GlassButton>
      </View>
      {panel && room >= MIN_PANEL ? (
        <Glass kind="sheet" style={[styles.panel, { top: tops.below, maxHeight: Math.min(360, room) }]}>
          {panel === "search" ? <SearchResults search={search} onChoose={choose} /> : <NearbyPanel onChoose={choose} onClose={() => setPanel(null)} />}
        </Glass>
      ) : null}
      {!(panel && room >= MIN_PANEL) && selection ? (
        <View style={styles.card} pointerEvents="box-none">
          {selection.kind === "place" ? <PlaceCard place={selection.place} /> : pin ? <PinCard pin={pin} now={now} /> : null}
        </View>
      ) : null}
      <DropPinSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", left: MAP_SIDE, right: MAP_SIDE + MAP_ROW + 10, flexDirection: "row", alignItems: "center", gap: 10 },
  search: { flex: 1, borderRadius: radii.pill },
  panel: { position: "absolute", left: 16, right: 16, borderRadius: radii.xl, overflow: "hidden" },
  card: { position: "absolute", left: 16, right: 76, bottom: 92 },
});
