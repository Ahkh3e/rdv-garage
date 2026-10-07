import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GeoJSONSource, Layer, ViewAnnotation } from "@maplibre/maplibre-react-native";
import { PulseDot, Text, carIconKey, colors } from "@rdv/core";
import { MIN_MODEL_ZOOM, carFeatures, type Car3D } from "./car3d";
import { RENDER_DELAY_MS, addSample, positionAt, type Sample } from "./interp";

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

const MIN_SELF_GLIDE_MS = 250;
const MAX_SELF_GLIDE_MS = 1200;
const FRAME_MS = 33;

const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

// Draws every car as a 3D model in the map. Other members move at a steady speed, drawn slightly behind real time
// (interp.ts); your own car glides linearly with the camera. All of the animation lives here, so the rest of the screen
// does not re-render while cars move.
export function CarLayer({ cars, zoom }: { cars: CarInput[]; zoom: number }) {
  const samples = useRef<Record<string, Sample[]>>({});
  const self = useRef<Record<string, Glide>>({});
  const interval = useRef<Record<string, number>>({});
  const [, setTick] = useState(0);

  const current = (car: CarInput) => {
    if (car.self) {
      const g = self.current[car.id];
      if (!g) return null;
      const k = Math.min(1, (Date.now() - g.t0) / g.ms);
      return {
        lng: g.from.lng + (g.to.lng - g.from.lng) * k,
        lat: g.from.lat + (g.to.lat - g.from.lat) * k,
        heading: (g.from.heading + turn(g.from.heading, g.to.heading) * k + 360) % 360,
      };
    }
    return positionAt(samples.current[car.id] ?? [], Date.now() - RENDER_DELAY_MS);
  };

  useEffect(() => {
    const seen = new Set<string>();
    const now = Date.now();
    for (const car of cars) {
      seen.add(car.id);
      if (car.self) {
        const g = self.current[car.id];
        const to = { lng: car.lng, lat: car.lat, heading: car.heading };
        if (!g) self.current[car.id] = { from: to, to, t0: now, ms: 1 };
        else if (Math.abs(g.to.lng - to.lng) + Math.abs(g.to.lat - to.lat) + Math.abs(turn(g.to.heading, to.heading)) > 1e-9) {
          // Glide for as long as the last fix took to arrive, so one glide ends as the next begins and it never stops and starts.
          // A smoothed interval, not the latest one: fixes arrive unevenly, and following each wobble makes the car pulse.
          const raw = Math.min(MAX_SELF_GLIDE_MS, Math.max(MIN_SELF_GLIDE_MS, now - g.t0));
          const ms = (interval.current[car.id] = interval.current[car.id] === undefined ? raw : interval.current[car.id]! * 0.8 + raw * 0.2);
          self.current[car.id] = { from: current(car) ?? g.to, to, t0: now, ms };
        }
      } else {
        const known = samples.current[car.id] ?? [];
        // A car seen for the first time starts at its first position, not delayed from nowhere.
        const first = known.length === 0;
        samples.current[car.id] = addSample(first ? [{ t: now - RENDER_DELAY_MS - 1, lng: car.lng, lat: car.lat, heading: car.heading }] : known, { t: now, lng: car.lng, lat: car.lat, heading: car.heading });
      }
    }
    for (const id of Object.keys(samples.current)) if (!seen.has(id)) delete samples.current[id];
    for (const id of Object.keys(self.current)) if (!seen.has(id)) delete self.current[id];
  }, [cars]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const moving =
        Object.values(self.current).some((g) => now - g.t0 < g.ms + 150) ||
        Object.values(samples.current).some((list) => list.length > 1 && now - RENDER_DELAY_MS < list[list.length - 1]!.t + 300);
      if (moving) setTick((n) => n + 1);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  const placed = cars.map((car) => ({ ...car, ...(current(car) ?? { lng: car.lng, lat: car.lat, heading: car.heading }) }));
  const features = useMemo(
    () => carFeatures(placed.map((c): Car3D => ({ id: c.id, lng: c.lng, lat: c.lat, heading: c.heading, icon: carIconKey(c.icon), color: c.color, stale: c.stale }))),
    [placed.map((c) => `${c.id}:${c.lng.toFixed(6)}:${c.lat.toFixed(6)}:${c.heading.toFixed(0)}:${c.stale ? 1 : 0}:${c.icon}:${c.color}`).join("|")], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const data = useMemo<GeoJSON.FeatureCollection>(() => ({ type: "FeatureCollection", features }), [features]);

  return (
    <>
      <GeoJSONSource id="cars" data={data} maxzoom={16} tolerance={0} buffer={0}>
        <Layer
          type="fill-extrusion"
          id="cars-3d"
          minzoom={MIN_MODEL_ZOOM}
          paint={{
            "fill-extrusion-color": ["get", "color"],
            "fill-extrusion-height": ["get", "top"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true,
          }}
        />
      </GeoJSONSource>
      {zoom < MIN_MODEL_ZOOM
        ? placed.map((c) => (
            <ViewAnnotation key={`dot-${c.id}`} id={`dot-${c.id}`} lngLat={[c.lng, c.lat]} anchor="center">
              <View style={[styles.farDot, { backgroundColor: c.color, opacity: c.stale ? 0.45 : 1, borderColor: c.self ? colors.text : colors.background }]} />
            </ViewAnnotation>
          ))
        : null}
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
  farDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
});
