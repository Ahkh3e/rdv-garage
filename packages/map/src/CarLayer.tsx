import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GeoJSONSource, Layer, ViewAnnotation } from "@maplibre/maplibre-react-native";
import { PulseDot, Text, carIconKey, colors } from "@rdv/core";
import { carFeatures, type Car3D } from "./car3d";

export interface CarInput {
  id: string;
  lng: number;
  lat: number;
  heading: number;
  icon: string;
  color: string;
  label?: string;
  stale?: boolean;
  self?: boolean;
}

interface Glide {
  from: { lng: number; lat: number; heading: number };
  to: { lng: number; lat: number; heading: number };
  t0: number;
  ms: number;
}

const OTHER_GLIDE_MS = 2600;
const SELF_GLIDE_MS = 450;

const ease = (k: number) => k * (2 - k);
const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

// Draws every car as a 3D model in the map and glides each one to its next position and heading, so nothing jumps.
// All of the animation lives here: the rest of the screen does not re-render while cars move.
export function CarLayer({ cars, zoom }: { cars: CarInput[]; zoom: number }) {
  const glides = useRef<Record<string, Glide>>({});
  const [, setTick] = useState(0);

  const current = (id: string) => {
    const g = glides.current[id];
    if (!g) return null;
    const k = ease(Math.min(1, (Date.now() - g.t0) / g.ms));
    return {
      lng: g.from.lng + (g.to.lng - g.from.lng) * k,
      lat: g.from.lat + (g.to.lat - g.from.lat) * k,
      heading: (g.from.heading + turn(g.from.heading, g.to.heading) * k + 360) % 360,
    };
  };

  useEffect(() => {
    const seen = new Set<string>();
    for (const car of cars) {
      seen.add(car.id);
      const g = glides.current[car.id];
      const to = { lng: car.lng, lat: car.lat, heading: car.heading };
      if (!g) glides.current[car.id] = { from: to, to, t0: Date.now(), ms: 1 };
      else if (Math.abs(g.to.lng - to.lng) + Math.abs(g.to.lat - to.lat) + Math.abs(turn(g.to.heading, to.heading)) > 1e-9) {
        glides.current[car.id] = { from: current(car.id) ?? g.to, to, t0: Date.now(), ms: car.self ? SELF_GLIDE_MS : OTHER_GLIDE_MS };
      }
    }
    for (const id of Object.keys(glides.current)) if (!seen.has(id)) delete glides.current[id];
  }, [cars]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      if (Object.values(glides.current).some((g) => now - g.t0 < g.ms + 150)) setTick((n) => n + 1);
    }, 250);
    return () => clearInterval(timer);
  }, []);

  const placed = cars.map((car) => ({ ...car, ...(current(car.id) ?? { lng: car.lng, lat: car.lat, heading: car.heading }) }));
  const features = useMemo(
    () => carFeatures(placed.map((c): Car3D => ({ id: c.id, lng: c.lng, lat: c.lat, heading: c.heading, icon: carIconKey(c.icon), color: c.color, stale: c.stale })), zoom),
    [placed.map((c) => `${c.id}:${c.lng.toFixed(6)}:${c.lat.toFixed(6)}:${c.heading.toFixed(0)}:${c.stale ? 1 : 0}:${c.icon}:${c.color}`).join("|"), zoom], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const data = useMemo<GeoJSON.FeatureCollection>(() => ({ type: "FeatureCollection", features }), [features]);

  return (
    <>
      <GeoJSONSource id="cars" data={data} maxzoom={16} tolerance={0} buffer={0}>
        <Layer
          type="fill-extrusion"
          id="cars-3d"
          paint={{
            "fill-extrusion-color": ["get", "color"],
            "fill-extrusion-height": ["get", "top"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true,
          }}
        />
      </GeoJSONSource>
      {placed.map((c) =>
        c.self ? (
          <ViewAnnotation key={`halo-${c.id}`} id={`halo-${c.id}`} lngLat={[c.lng, c.lat]} anchor="center">
            <PulseDot size={1} halo={70} />
          </ViewAnnotation>
        ) : c.label ? (
          <ViewAnnotation key={`name-${c.id}`} id={`name-${c.id}`} lngLat={[c.lng, c.lat]} anchor="top" offset={[0, 0]}>
            <View style={[styles.pill, { opacity: c.stale ? 0.45 : 1 }]}>
              <View style={[styles.dot, { backgroundColor: c.color }]} />
              <Text variant="caption" numberOfLines={1} style={{ color: colors.text }}>{c.label}</Text>
            </View>
          </ViewAnnotation>
        ) : null,
      )}
    </>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: 120 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
