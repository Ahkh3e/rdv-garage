// "RDV Night": a monochrome charcoal-blue night style for the shared map. Vector tiles come from OpenFreeMap
// (OpenStreetMap data, no key needed). Near-black ground, grey roads that get lighter as they get bigger, no colour
// except the single blue accent, which the map screen adds for the person's own marker.
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_ITALIC = ["Noto Sans Italic"];

export const MAP_COLORS = {
  ground: "#11141A",
  park: "#151A21",
  wood: "#141820",
  residential: "#10131A",
  industrial: "#0F1218",
  water: "#0A0C11",
  building: "#171B23",
  buildingTop: "#1D222C",
  casing: "#0A0C10",
  minor: "#2A303B",
  service: "#222833",
  tertiary: "#3A4150",
  secondary: "#586073",
  primary: "#8A93A6",
  trunk: "#B4BDCE",
  motorway: "#E4EAF5",
  rail: "#262C37",
  label: "rgba(200,212,235,0.5)",
  labelStrong: "#E6ECF7",
  labelWater: "#4B5568",
  halo: "#0A0C10",
  poi: "rgba(140,160,196,0.55)",
} as const;

// The six Nearby categories (docs/features/places.md). Classes and subclasses as they appear in the OpenMapTiles poi layer.
export const POI_CLASSES = ["fuel", "gas", "gas_station", "restaurant", "fast_food", "food_court", "cafe", "coffee", "coffee_shop", "parking", "car_wash", "charging_station"] as const;
export const POI_LAYER = "poi";

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
      id: POI_LAYER, type: "circle", source: "openmaptiles", "source-layer": "poi", minzoom: 13,
      filter: ["any", ["in", ["get", "class"], ["literal", [...POI_CLASSES]]], ["in", ["get", "subclass"], ["literal", [...POI_CLASSES]]]],
      paint: {
        "circle-color": MAP_COLORS.poi,
        "circle-radius": w([13, 1.6], [17, 3.2]),
        "circle-opacity": 0.7,
        "circle-stroke-color": MAP_COLORS.halo,
        "circle-stroke-width": 0.8,
      },
    },
    {
      id: "poi-name", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 16,
      filter: ["any", ["in", ["get", "class"], ["literal", [...POI_CLASSES]]], ["in", ["get", "subclass"], ["literal", [...POI_CLASSES]]]],
      layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": FONT, "text-size": 10, "text-anchor": "top", "text-offset": [0, 0.7], "text-optional": true },
      paint: { "text-color": MAP_COLORS.label, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.2, "text-opacity": 0.75 },
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
