import { useMemo } from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { colors, useShell, useStore } from "@rdv/core";
import { pinFeatures } from "./pins";

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
      <Layer type="circle" id="pins-dot" style={{ circleColor: ["get", "color"], circleRadius: 7, circleStrokeColor: colors.background, circleStrokeWidth: 2 }} />
      <Layer
        type="symbol"
        id="pins-label"
        minzoom={13}
        style={{ textField: ["get", "label"], textSize: 12, textOffset: [0, 1.2], textAnchor: "top", textColor: colors.text, textHaloColor: colors.background, textHaloWidth: 1.5, textOptional: true }}
      />
    </GeoJSONSource>
  );
}
