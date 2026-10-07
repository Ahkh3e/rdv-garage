import { useMemo } from "react";
import { GeoJSONSource, Images, Layer } from "@maplibre/maplibre-react-native";
import { PIN_KIND, colors, useShell, useStore } from "@rdv/core";
import { pinFeatures } from "./pins";

const PIN_IMAGE = { source: require("../assets/pin.png"), sdf: true };
const IS_PIN = ["==", ["get", "kind"], PIN_KIND] as never;
const NOT_PIN = ["!=", ["get", "kind"], PIN_KIND] as never;

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
      <Images images={{ "rdv-pin": PIN_IMAGE }} />
      <Layer
        type="symbol"
        id="pins-glyph"
        filter={IS_PIN}
        style={{ iconImage: "rdv-pin", iconColor: ["get", "color"], iconSize: 0.55, iconAnchor: "bottom", iconAllowOverlap: true, iconIgnorePlacement: true }}
      />
      <Layer type="circle" id="pins-dot" filter={NOT_PIN} style={{ circleColor: ["get", "color"], circleRadius: 7, circleStrokeColor: colors.background, circleStrokeWidth: 2 }} />
      <Layer
        type="symbol"
        id="pins-label"
        minzoom={13}
        style={{ textField: ["get", "label"], textSize: 12, textOffset: [0, 0.3], textAnchor: "top", textColor: colors.text, textHaloColor: colors.background, textHaloWidth: 1.5, textOptional: true }}
      />
    </GeoJSONSource>
  );
}
