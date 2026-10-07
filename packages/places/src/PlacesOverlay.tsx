import { useEffect, useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Glass, GlassButton, colors, radii, useShell, useStore, type Place } from "@rdv/core";
import { PinCard, PlaceCard } from "./Cards";
import { useController } from "./context";
import { DropPinSheet } from "./DropPinSheet";
import { NearbyPanel } from "./NearbyPanel";
import { SearchField, SearchResults, useSearch } from "./SearchResults";
import { queryReady } from "./validation";

export function PlacesOverlay() {
  const shell = useShell();
  const controller = useController();
  const search = useSearch();
  const { selection, pins } = useStore(controller.state);
  const [panel, setPanel] = useState<"search" | "nearby" | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => controller.start(), [controller]);
  useEffect(() => shell.mapBridge.onLongPress((point) => controller.startDrop(point)), [shell, controller]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Blur fires before a press on a Recent row lands, so the check waits a beat and reads the query then.
  const closeIfIdle = () => {
    setTimeout(() => {
      if (!queryReady(search.state.get().query)) setPanel((p) => (p === "search" ? null : p));
    }, 250);
  };

  const choose = (place: Place) => {
    Keyboard.dismiss();
    setPanel(null);
    search.reset();
    controller.openPlace(place);
  };

  const pin = selection?.kind === "pin" ? pins.find((p) => p.id === selection.pinId) : null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.top} pointerEvents="box-none">
        <Glass kind="control" style={styles.search}>
          <SearchField search={search} onFocus={() => setPanel("search")} onBlur={closeIfIdle} onClear={() => setPanel(null)} />
        </Glass>
        <GlassButton testID="places-nearby" label="Nearby" onPress={() => { Keyboard.dismiss(); setPanel((p) => (p === "nearby" ? null : "nearby")); }}>
          <Feather name="compass" size={19} color={panel === "nearby" ? colors.accentBright : colors.text} />
        </GlassButton>
      </View>
      {panel ? (
        <Glass kind="sheet" style={styles.panel}>
          {panel === "search" ? <SearchResults search={search} onChoose={choose} /> : <NearbyPanel onChoose={choose} onClose={() => setPanel(null)} />}
        </Glass>
      ) : null}
      {!panel && selection ? (
        <View style={styles.card} pointerEvents="box-none">
          {selection.kind === "place" ? <PlaceCard place={selection.place} /> : pin ? <PinCard pin={pin} now={now} /> : null}
        </View>
      ) : null}
      <DropPinSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", top: 98, left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  search: { flex: 1, borderRadius: radii.pill },
  panel: { position: "absolute", top: 208, left: 16, right: 16, maxHeight: 360, borderRadius: radii.xl, overflow: "hidden" },
  card: { position: "absolute", left: 16, right: 76, bottom: 92 },
});
