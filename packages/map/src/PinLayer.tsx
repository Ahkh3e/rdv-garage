import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { GeoJSONSource, Images, Layer } from "@maplibre/maplibre-react-native";
import { PIN_KIND, RDV_KIND, colors, useShell, useStore } from "@rdv/core";
import { PULSE_CYCLE_MS, PULSE_STEPS, PULSE_STILL, pinFeatures, pulsePhase, pulseStep } from "./pins";

const FLAG_IMAGE = { source: require("../assets/flag.png") };
const IS_PIN = ["==", ["get", "kind"], PIN_KIND] as never;
const IS_RDV = ["==", ["get", "kind"], RDV_KIND] as never;
const IS_DOT = ["all", ["!=", ["get", "kind"], PIN_KIND], ["!=", ["get", "kind"], RDV_KIND]] as never;
const IS_LIVE_RDV = ["all", ["==", ["get", "kind"], RDV_KIND], ["==", ["get", "live"], true]] as never;
const NOT_RDV = ["!=", ["get", "kind"], RDV_KIND] as never;

export function PinLayer() {
  const shell = useShell();
  const pins = useStore(shell.pins.store);
  const data = useMemo<GeoJSON.FeatureCollection>(() => ({ type: "FeatureCollection", features: pinFeatures(pins) }), [pins]);

  const hasPins = pins.some((pin) => pin.kind === PIN_KIND);
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [still, setStill] = useState(false);
  const [phase, setPhase] = useState(PULSE_STILL);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setActive(next === "active"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => alive && setStill(on), () => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setStill);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const animate = hasPins && focused && active && !still;
  useEffect(() => {
    if (!animate) {
      setPhase(PULSE_STILL);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => setPhase(pulsePhase(pulseStep(Date.now() - start))), PULSE_CYCLE_MS / PULSE_STEPS);
    return () => clearInterval(timer);
  }, [animate]);

  return (
    <>
      <Images images={{ "rdv-flag": FLAG_IMAGE }} />
    <GeoJSONSource
      id="pins"
      data={data}
      onPress={(event) => {
        const id = event.nativeEvent.features?.[0]?.properties?.id;
        if (typeof id === "string") shell.pins.press(id);
      }}
    >
      <Layer type="circle" id="pins-rdv-ring" filter={IS_RDV} style={{ circleColor: colors.background, circleRadius: 15, circleStrokeColor: ["get", "color"], circleStrokeWidth: 3 }} />
      <Layer type="symbol" id="pins-rdv-flag" filter={IS_RDV} style={{ iconImage: "rdv-flag", iconSize: 0.3, iconAllowOverlap: true, iconIgnorePlacement: true }} />
      <Layer
        type="symbol"
        id="pins-rdv-live"
        filter={IS_LIVE_RDV}
        style={{ textField: "LIVE", textFont: ["Noto Sans Bold"], textSize: 9, textOffset: [0, -2.6], textColor: colors.onAccent, textHaloColor: colors.accent, textHaloWidth: 3, textAllowOverlap: true, textIgnorePlacement: true }}
      />
      <Layer
        type="symbol"
        id="pins-rdv-label"
        filter={IS_RDV}
        minzoom={13}
        style={{ textField: ["get", "label"], textFont: ["Noto Sans Bold"], textSize: 12, textOffset: [0, 1.9], textAnchor: "top", textColor: colors.text, textHaloColor: colors.background, textHaloWidth: 1.5, textOptional: true }}
      />
      <Layer type="circle" id="pins-dot" filter={IS_DOT} style={{ circleColor: ["get", "color"], circleRadius: 7, circleStrokeColor: colors.background, circleStrokeWidth: 2 }} />
      <Layer type="circle" id="pins-pulse-a" filter={IS_PIN} style={{ circleColor: ["get", "color"], circleRadius: 9 + 26 * phase, circleOpacity: 0.55 * (1 - phase), circleStrokeColor: ["get", "color"], circleStrokeWidth: 2, circleStrokeOpacity: 1 - phase }} />
      <Layer type="circle" id="pins-pulse-b" filter={IS_PIN} style={{ circleColor: ["get", "color"], circleRadius: 9 + 26 * ((phase + 0.5) % 1), circleOpacity: 0.55 * (1 - ((phase + 0.5) % 1)), circleStrokeColor: ["get", "color"], circleStrokeWidth: 2, circleStrokeOpacity: 1 - ((phase + 0.5) % 1) }} />
      <Layer type="circle" id="pins-core" filter={IS_PIN} style={{ circleColor: ["get", "color"], circleRadius: 8, circleStrokeColor: "#FFFFFF", circleStrokeWidth: 3 }} />
      <Layer
        type="symbol"
        id="pins-label"
        filter={NOT_RDV}
        minzoom={13}
        style={{ textField: ["get", "label"], textFont: ["Noto Sans Bold"], textSize: 12, textOffset: [0, 1.6], textAnchor: "top", textColor: colors.text, textHaloColor: colors.background, textHaloWidth: 1.5, textOptional: true }}
      />
    </GeoJSONSource>
    </>
  );
}
