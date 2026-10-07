import { useMemo } from "react";
import { GeoJSONSource, Images, Layer } from "@maplibre/maplibre-react-native";
import { PIN_KIND, RDV_KIND, colors, useShell, useStore } from "@rdv/core";
import { pinFeatures } from "./pins";

const PIN_IMAGE = { source: require("../assets/pin.png"), sdf: true };
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

  return (
    <GeoJSONSource
      id="pins"
      data={data}
      onPress={(event) => {
        const id = event.nativeEvent.features?.[0]?.properties?.id;
        if (typeof id === "string") shell.pins.press(id);
      }}
    >
      <Images images={{ "rdv-pin": PIN_IMAGE, "rdv-flag": FLAG_IMAGE }} />
      <Layer
        type="symbol"
        id="pins-glyph"
        filter={IS_PIN}
        style={{ iconImage: "rdv-pin", iconColor: ["get", "color"], iconSize: 0.55, iconAnchor: "bottom", iconAllowOverlap: true, iconIgnorePlacement: true }}
      />
      <Layer type="circle" id="pins-rdv-ring" filter={IS_RDV} style={{ circleColor: colors.background, circleRadius: 15, circleStrokeColor: ["get", "color"], circleStrokeWidth: 3 }} />
      <Layer type="symbol" id="pins-rdv-flag" filter={IS_RDV} style={{ iconImage: "rdv-flag", iconSize: 0.3, iconAllowOverlap: true, iconIgnorePlacement: true }} />
      <Layer
        type="symbol"
        id="pins-rdv-live"
        filter={IS_LIVE_RDV}
        style={{ textField: "LIVE", textSize: 9, textOffset: [0, -2.6], textColor: colors.onAccent, textHaloColor: colors.accent, textHaloWidth: 3, textAllowOverlap: true, textIgnorePlacement: true }}
      />
      <Layer
        type="symbol"
        id="pins-rdv-label"
        filter={IS_RDV}
        minzoom={13}
        style={{ textField: ["get", "label"], textSize: 12, textOffset: [0, 1.9], textAnchor: "top", textColor: colors.text, textHaloColor: colors.background, textHaloWidth: 1.5, textOptional: true }}
      />
      <Layer type="circle" id="pins-dot" filter={IS_DOT} style={{ circleColor: ["get", "color"], circleRadius: 7, circleStrokeColor: colors.background, circleStrokeWidth: 2 }} />
      <Layer
        type="symbol"
        id="pins-label"
        filter={NOT_RDV}
        minzoom={13}
        style={{ textField: ["get", "label"], textSize: 12, textOffset: [0, 0.3], textAnchor: "top", textColor: colors.text, textHaloColor: colors.background, textHaloWidth: 1.5, textOptional: true }}
      />
    </GeoJSONSource>
  );
}
