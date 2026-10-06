// "RDV Night": a Waze-inspired night style for the shared map. Vector tiles come from OpenFreeMap (OpenStreetMap data,
// no key needed). Deep navy ground, bright roads that get lighter as they get bigger, blue water, quiet labels.
// The one accent colour (the person's own marker) is added by the map screen, not by the style.
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_ITALIC = ["Noto Sans Italic"];

export const MAP_COLORS = {
  ground: "#0A0E14",
  park: "#0F2A24",
  wood: "#0D241F",
  residential: "#0C1218",
  industrial: "#0B1016",
  water: "#0C2D4F",
  building: "#151D28",
  buildingTop: "#1B2634",
  casing: "#05080C",
  minor: "#2C3848",
  service: "#222C39",
  tertiary: "#4A5B73",
  secondary: "#6F83A0",
  primary: "#B3C6DC",
  trunk: "#DDE9F6",
  motorway: "#FFFFFF",
  rail: "#2A3442",
  label: "rgba(255,255,255,0.55)",
  labelStrong: "#E6EEF7",
  labelWater: "#5F87B0",
  halo: "#0A0E14",
} as const;

const w = (...stops: [number, number][]) => ["interpolate", ["exponential", 1.4], ["zoom"], ...stops.flat()] as never;

const road = (id: string, classes: string[], color: string, width: unknown, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["all", ["in", "class", ...classes], ["!=", "brunnel", "tunnel"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": width },
    ...extra,
  }) as never;

const casing = (id: string, classes: string[], width: unknown) =>
  road(id, classes, MAP_COLORS.casing, width, { paint: { "line-color": MAP_COLORS.casing, "line-width": width, "line-opacity": 0.9 } });

const baseStyle: StyleSpecification = {
  version: 8,
  name: "RDV Night",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": MAP_COLORS.ground } },
    {
      id: "landcover-wood", type: "fill", source: "openmaptiles", "source-layer": "landcover",
      filter: ["in", "class", "wood", "grass"], paint: { "fill-color": MAP_COLORS.wood, "fill-opacity": 0.9 },
    },
    {
      id: "landuse-park", type: "fill", source: "openmaptiles", "source-layer": "landuse",
      filter: ["in", "class", "park", "cemetery", "pitch", "playground", "recreation_ground"], paint: { "fill-color": MAP_COLORS.park },
    },
    {
      id: "landuse-industrial", type: "fill", source: "openmaptiles", "source-layer": "landuse",
      filter: ["in", "class", "industrial", "railway", "commercial", "retail"], paint: { "fill-color": MAP_COLORS.industrial },
    },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": MAP_COLORS.water } },
    {
      id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway",
      paint: { "line-color": MAP_COLORS.water, "line-width": w([10, 0.6], [16, 3]) },
    },
    {
      id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 14, maxzoom: 15.5,
      paint: { "fill-color": MAP_COLORS.building, "fill-opacity": 0.9 },
    },
    {
      id: "building-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 15,
      paint: {
        "fill-extrusion-color": MAP_COLORS.buildingTop,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.5,
      },
    },
    {
      id: "rail", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["==", "class", "rail"],
      paint: { "line-color": MAP_COLORS.rail, "line-width": 1, "line-dasharray": [3, 3] },
    },
    casing("casing-minor", ["minor", "service", "track", "path"], w([13, 1.4], [18, 12])),
    casing("casing-tertiary", ["tertiary"], w([10, 1.2], [18, 18])),
    casing("casing-secondary", ["secondary"], w([8, 1.4], [18, 22])),
    casing("casing-primary", ["primary"], w([7, 1.6], [18, 26])),
    casing("casing-trunk", ["trunk"], w([5, 1.8], [18, 30])),
    casing("casing-motorway", ["motorway"], w([4, 2], [18, 34])),
    road("road-service", ["service", "track", "path"], MAP_COLORS.service, w([14, 0.6], [18, 7])),
    road("road-minor", ["minor"], MAP_COLORS.minor, w([12, 0.6], [18, 10])),
    road("road-tertiary", ["tertiary"], MAP_COLORS.tertiary, w([10, 0.8], [18, 15])),
    road("road-secondary", ["secondary"], MAP_COLORS.secondary, w([8, 1], [18, 19])),
    road("road-primary", ["primary"], MAP_COLORS.primary, w([7, 1.2], [18, 23])),
    road("road-trunk", ["trunk"], MAP_COLORS.trunk, w([5, 1.4], [18, 27])),
    road("road-motorway", ["motorway"], MAP_COLORS.motorway, w([4, 1.6], [18, 31])),
    {
      id: "road-name", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", minzoom: 13,
      layout: {
        "symbol-placement": "line", "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": FONT,
        "text-size": w([13, 9], [18, 11]), "text-letter-spacing": 0.05,
      },
      paint: { "text-color": MAP_COLORS.label, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.4 },
    },
    {
      id: "water-name", type: "symbol", source: "openmaptiles", "source-layer": "water_name",
      layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": FONT_ITALIC, "text-size": 12 },
      paint: { "text-color": MAP_COLORS.labelWater, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1 },
    },
    {
      id: "place-suburb", type: "symbol", source: "openmaptiles", "source-layer": "place", minzoom: 11,
      filter: ["in", "class", "suburb", "neighbourhood", "quarter"],
      layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": FONT, "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": 0.12 },
      paint: { "text-color": MAP_COLORS.label, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.2, "text-opacity": 0.8 },
    },
    {
      id: "place-city", type: "symbol", source: "openmaptiles", "source-layer": "place", maxzoom: 14,
      filter: ["in", "class", "city", "town", "village"],
      layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": FONT_BOLD, "text-size": w([4, 11], [12, 16]) },
      paint: { "text-color": MAP_COLORS.labelStrong, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.5 },
    },
  ] as never,
};

// The same style without extruded buildings, for the flat 2D view: footprints stay visible at every close zoom.
function flatten(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers
      .filter((layer) => layer.id !== "building-3d")
      .map((layer) => (layer.id === "building" ? ({ ...layer, maxzoom: 24 } as typeof layer) : layer)),
  };
}

export const rdvNightStyle: StyleSpecification = baseStyle;
export const rdvNightStyleFlat: StyleSpecification = flatten(baseStyle);

// Camera used while following: tilted, close behind the car, heading up.
export const FOLLOW_CAMERA = { zoom: 16.6, pitch: 55 } as const;
export const FLAT_PITCH = 0;
export const OVERVIEW_CAMERA = { zoom: 11.5, pitch: 0 } as const;
