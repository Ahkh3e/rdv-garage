import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { Camera, GeoJSONSource, Layer, Map, ViewAnnotation, type CameraRef, type MapRef } from "@maplibre/maplibre-react-native";
import { Avatar, CarIcon, Glass, GlassButton, Slot, Text, bearingDegrees, colors, crewStyle, haversineMeters, radii, useCrewState, usePositions, useSession } from "@rdv/core";
import { GlidingAnnotation } from "./GlidingAnnotation";
import { MemberMarker, SelfMarker } from "./MemberMarker";
import { RoadIndex, linesFromFeatures } from "./roadSnap";
import { appendTrail, snapTrail, trailFeatures, type TrailPoint, type TrailSet } from "./trails";
import { FLAT_PITCH, FOLLOW_CAMERA, rdvNightStyle, rdvNightStyleFlat } from "./style";

const TORONTO: [number, number] = [-79.3832, 43.6532];
const FADE_AFTER_MS = 45000;
const EXPANDED = 0.75;
const COLLAPSED = 0.25;
const SHEET_OVERLAP = 20;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
const JUMP_ZOOM = 16;
const ROAD_LAYERS = ["road-service", "road-minor", "road-tertiary", "road-secondary", "road-primary", "road-trunk", "road-motorway"];
const MIN_SNAP_ZOOM = 13.5;
// Like a navigation route: the trail is as wide as the road under it, so its width follows the map style's road widths.
const roadWidth = (k: number) => ["interpolate", ["exponential", 1.4], ["zoom"], 8, 0.8 * k, 12, 2 * k, 14, 4 * k, 16, 7 * k, 18, 14 * k, 20, 28 * k] as never;
const TRAIL_WIDTH = roadWidth(1);
const TRAIL_GLOW_WIDTH = roadWidth(1.7);

interface Me {
  lat: number;
  lng: number;
  heading: number | null;
}

export function MapScreen() {
  const focused = useIsFocused();
  const session = useSession();
  const crewState = useCrewState();
  const positions = usePositions();
  const camera = useRef<CameraRef>(null);
  const lastHeading = useRef(0);
  const zoom = useRef<number>(FOLLOW_CAMERA.zoom);
  const followZoom = useRef<number>(FOLLOW_CAMERA.zoom);
  const [follow, setFollow] = useState(true);
  const [bearing, setBearing] = useState(0);
  const headings = useRef<Record<string, number>>({});
  const [view3d, setView3d] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const mapRef = useRef<MapRef>(null);
  const roads = useRef<RoadIndex | null>(null);
  const roadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [roadVersion, setRoadVersion] = useState(0);
  const dirty = useRef(false);
  const lastRoadQuery = useRef<{ lng: number; lat: number; zoom: number; at: number } | null>(null);
  const trails = useRef<Record<string, TrailSet>>({});
  const [trailTick, setTrailTick] = useState(0);
  const [followMember, setFollowMember] = useState(false);
  const pitch = useRef<number>(FOLLOW_CAMERA.pitch);
  const [me, setMe] = useState<Me | null>(null);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [now, setNow] = useState(Date.now());
  const [height, setHeight] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const mapHeight = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  // The map takes three quarters of the screen. Scrolling the member list up squeezes it to a quarter, and jumping to
  // someone opens it back up.
  useEffect(() => {
    if (!height) return;
    Animated.timing(mapHeight, {
      toValue: Math.round(height * (expanded ? EXPANDED : COLLAPSED)),
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [height, expanded, mapHeight]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    if (!height) mapHeight.setValue(Math.round(next * EXPANDED));
    setHeight(next);
  };

  // Foreground location for the map itself: your marker and follow mode. Sharing is separate and starts with Go live.
  useEffect(() => {
    if (!focused) return;
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    (async () => {
      const result = await Location.requestForegroundPermissionsAsync();
      if (!alive) return;
      if (result.status !== "granted") return setPermission("denied");
      setPermission("granted");
      let previous: { lat: number; lng: number } | null = null;
      let derived: number | null = null;
      const watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 1000 }, (loc) => {
        const here = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        // Some phones and simulators report no heading. Fall back to the direction of travel between two fixes.
        if (previous && haversineMeters(previous, here) >= 4) {
          derived = bearingDegrees(previous, here);
          previous = here;
        } else if (!previous) previous = here;
        const reported = loc.coords.heading !== null && loc.coords.heading >= 0 ? loc.coords.heading : null;
        const moving = (loc.coords.speed ?? 0) > 2 || derived !== null;
        setMe({ ...here, heading: moving ? (reported ?? derived) : null });
      });
      if (!alive) return watcher.remove();
      sub = watcher;
    })();
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [focused]);

  const easeToMe = useCallback((at: Me, duration = 700) => {
    if (at.heading !== null) lastHeading.current = at.heading;
    camera.current?.easeTo({
      center: [at.lng, at.lat],
      zoom: followZoom.current,
      pitch: pitch.current,
      bearing: lastHeading.current,
      duration,
      easing: "linear",
    });
  }, []);

  // Follow mode, Waze style: tilted, close behind you, turning with the road. The camera keeps your last heading when you stop.
  useEffect(() => {
    if (follow && me) easeToMe(me);
  }, [me, follow, easeToMe]);

  const lookup = useMemo(() => {
    const map = new globalThis.Map<string, { handle: string; avatarPath: string | null; carIcon: string; styleIndex: number; crewNames: string[] }>();
    for (const crew of crewState.crews) {
      if (!crewState.selected.includes(crew.id)) continue;
      for (const member of crew.members) {
        const known = map.get(member.userId);
        if (known) known.crewNames.push(crew.name);
        else map.set(member.userId, { handle: member.handle, avatarPath: member.avatarPath, carIcon: member.carIcon, styleIndex: crew.styleIndex, crewNames: [crew.name] });
      }
    }
    return map;
  }, [crewState]);

  const myId = session.status === "signedIn" ? session.userId : null;
  const myIcon = session.status === "signedIn" ? session.profile.carIcon : "gt";

  // A parked car keeps its last heading, and the car turns relative to the map so it points the way it is travelling.
  const rotationFor = (id: string, heading: number | null | undefined) => {
    if (heading !== null && heading !== undefined && heading >= 0) headings.current[id] = heading;
    return (((headings.current[id] ?? 0) - bearing) % 360 + 360) % 360;
  };
  const others = Object.values(positions).filter(
    (p) => p.userId !== myId && p.crewIds.some((id) => crewState.selected.includes(id)) && lookup.has(p.userId),
  );

  // The road lines the map has already loaded for what is on screen. Trails are matched to these on the phone only.
  const refreshRoads = useCallback((center?: [number, number]) => {
    if (roadTimer.current) clearTimeout(roadTimer.current);
    roadTimer.current = setTimeout(async () => {
      if (zoom.current < MIN_SNAP_ZOOM) return;
      const last = lastRoadQuery.current;
      const now = Date.now();
      // Only look again after the view has moved a good way or zoomed, and not more than every couple of seconds.
      if (last && roads.current) {
        const moved = center ? Math.hypot((center[0] - last.lng) * 80000, (center[1] - last.lat) * 111320) : 0;
        if (now - last.at < 2500 || (moved < 200 && Math.abs(zoom.current - last.zoom) < 0.7)) return;
      }
      try {
        const features = await mapRef.current?.queryRenderedFeatures({ layers: ROAD_LAYERS });
        const lines = linesFromFeatures(features ?? []);
        if (lines.length === 0) return;
        roads.current = new RoadIndex(lines);
        lastRoadQuery.current = { lng: center?.[0] ?? 0, lat: center?.[1] ?? 0, zoom: zoom.current, at: now };
        setRoadVersion((n) => n + 1);
      } catch {
        // The map is not ready yet; the next region change tries again.
      }
    }, 600);
  }, []);
  useEffect(() => () => void (roadTimer.current && clearTimeout(roadTimer.current)), []);

  // Trail drawing is throttled: the line is rebuilt about once a second however often positions arrive.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!dirty.current) return;
      dirty.current = false;
      setTrailTick((n) => n + 1);
    }, 900);
    return () => clearInterval(timer);
  }, []);

  // Movement trails: the last few minutes of positions already shared with the crew, kept in memory only.
  useEffect(() => {
    const t = Date.now();
    const next: Record<string, TrailSet> = {};
    for (const p of others) {
      const info = lookup.get(p.userId);
      // Someone who has stopped sending updates keeps their marker (it fades) but their trail is cleared.
      if (!info || t - p.ts > FADE_AFTER_MS) continue;
      const point: TrailPoint = { lng: p.lng, lat: p.lat, ts: p.ts };
      next[p.userId] = { color: crewStyle(info.styleIndex).tint, points: appendTrail(trails.current[p.userId]?.points ?? [], point, t) };
    }
    if (me) next.me = { color: colors.accentBright, points: appendTrail(trails.current.me?.points ?? [], { lng: me.lng, lat: me.lat, ts: t }, t) };
    for (const trail of Object.values(next)) snapTrail(trail.points, roads.current);
    trails.current = next;
    dirty.current = true;
  }, [positions, crewState.selected, me]); // eslint-disable-line react-hooks/exhaustive-deps

  // New road geometry arrived: match any points that were waiting for it.
  useEffect(() => {
    for (const trail of Object.values(trails.current)) snapTrail(trail.points, roads.current);
    dirty.current = true;
  }, [roadVersion]);

  // Where a marker is drawn: on the road once the trail has been matched to one.
  const headPosition = (id: string, raw: { lng: number; lat: number }) => {
    const head = trails.current[id]?.points.at(-1);
    return head?.snap ? { lng: head.snap.lng, lat: head.snap.lat } : { lng: raw.lng, lat: raw.lat };
  };

  const trailData = useMemo(() => trailFeatures(trails.current), [trailTick]);

  const selectedPosition = selected ? others.find((p) => p.userId === selected) ?? null : null;
  const selectedInfo = selected ? lookup.get(selected) ?? null : null;

  // Following someone else: the camera stays on them as they move. Dragging the map lets go.
  useEffect(() => {
    if (!followMember || !selectedPosition) return;
    camera.current?.easeTo({ center: [selectedPosition.lng, selectedPosition.lat], zoom: JUMP_ZOOM, pitch: pitch.current, bearing: 0, duration: 800 });
  }, [followMember, selectedPosition?.lat, selectedPosition?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeCard = () => {
    setSelected(null);
    setFollowMember(false);
  };

  const members = useMemo(() => {
    const livePositions = new globalThis.Map(others.map((p) => [p.userId, p]));
    return [...lookup.entries()]
      .filter(([id]) => id !== myId)
      .map(([id, info]) => ({ id, ...info, position: livePositions.get(id) ?? null }))
      .sort((a, b) => Number(!!b.position) - Number(!!a.position) || a.handle.localeCompare(b.handle));
  }, [lookup, others, myId]);

  const showEveryone = () => {
    if (others.length === 0) return;
    const points = others.map((p) => [p.lng, p.lat] as const);
    if (me) points.push([me.lng, me.lat]);
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const pad = 0.002;
    const west = Math.min(...lngs);
    const east = Math.max(...lngs);
    const south = Math.min(...lats);
    const north = Math.max(...lats);
    const bounds: [number, number, number, number] =
      east - west < pad && north - south < pad ? [west - pad, south - pad, east + pad, north + pad] : [west, south, east, north];
    setFollow(false);
    setExpanded(true);
    camera.current?.fitBounds(bounds, {
      padding: { top: 120, right: 90, bottom: 110, left: 90 },
      pitch: 0,
      bearing: 0,
      duration: 700,
    });
  };

  const jumpTo = (id: string, lat: number, lng: number) => {
    setSelected(id);
    setFollowMember(false);
    setFollow(false);
    setExpanded(true);
    camera.current?.easeTo({ center: [lng, lat], zoom: JUMP_ZOOM, pitch: view3d ? 45 : FLAT_PITCH, bearing: 0, duration: 800 });
  };

  const rehome = () => {
    followZoom.current = FOLLOW_CAMERA.zoom;
    setFollow(true);
    setFollowMember(false);
    setSelected(null);
    if (me) easeToMe(me, 500);
    else camera.current?.easeTo({ center: TORONTO, zoom: 11.5, pitch: 0, bearing: 0, duration: 500 });
  };

  const toggleView = () => {
    const next = !view3d;
    setView3d(next);
    pitch.current = next ? FOLLOW_CAMERA.pitch : FLAT_PITCH;
    camera.current?.setStop({ pitch: pitch.current, duration: 400, easing: "ease" });
  };

  const step = (delta: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.current + delta));
    zoom.current = next;
    followZoom.current = next;
    if (follow && me) easeToMe(me, 300);
    else camera.current?.zoomTo(next, { duration: 300 });
  };

  const onListScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event.nativeEvent.contentOffset.y > 12) setExpanded(false);
  };
  const onListRelease = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event.nativeEvent.contentOffset.y <= -24) setExpanded(true);
  };

  const live = others.length;

  return (
    <View style={styles.root} onLayout={onLayout}>
      <Animated.View style={[styles.mapArea, { height: mapHeight }]}>
        <Map
          ref={mapRef}
          testID="map-view"
          style={StyleSheet.absoluteFill}
          mapStyle={view3d ? rdvNightStyle : rdvNightStyleFlat}
          compass={false}
          logo={false}
          tintColor={colors.subtle}
          attribution
          attributionPosition={{ bottom: SHEET_OVERLAP + 6, left: 8 }}
          onDidFinishRenderingMapFully={() => refreshRoads()}
          onRegionDidChange={(event) => {
            zoom.current = event.nativeEvent.zoom;
            setBearing(event.nativeEvent.bearing ?? 0);
            refreshRoads(event.nativeEvent.center as [number, number]);
            // Dragging or pinching the map by hand ends follow mode; the home button brings it back.
            if (event.nativeEvent.userInteraction) {
              setFollow(false);
              setFollowMember(false);
            }
          }}
        >
          <Camera ref={camera} initialViewState={{ center: TORONTO, zoom: 11.5 }} />
          <GeoJSONSource id="trails" data={trailData}>
            <Layer type="line" id="trail-glow" style={{ lineColor: ["get", "color"], lineOpacity: ["*", ["get", "a"], 0.35], lineWidth: TRAIL_GLOW_WIDTH, lineBlur: 10, lineCap: "round", lineJoin: "round" }} />
            <Layer type="line" id="trail-line" style={{ lineColor: ["get", "color"], lineOpacity: ["get", "a"], lineWidth: TRAIL_WIDTH, lineCap: "round", lineJoin: "round" }} />
          </GeoJSONSource>
          {me ? (
            <GlidingAnnotation id="me" target={headPosition("me", me)} ms={450}>
              <SelfMarker carIcon={myIcon} rotation={rotationFor("me", me.heading)} />
            </GlidingAnnotation>
          ) : null}
          {others.map((p) => {
            const info = lookup.get(p.userId)!;
            return (
              <GlidingAnnotation key={p.userId} id={p.userId} target={headPosition(p.userId, p)}>
                <MemberMarker handle={info.handle} carIcon={info.carIcon} styleIndex={info.styleIndex} stale={now - p.ts > FADE_AFTER_MS} rotation={rotationFor(p.userId, p.heading)} />
              </GlidingAnnotation>
            );
          })}
        </Map>

        <View style={styles.top} pointerEvents="box-none">
          <Pressable testID="map-show-everyone" accessibilityRole="button" accessibilityLabel="Show everyone live" onPress={showEveryone}>
            <Glass kind="control" style={styles.pill}>
              <View style={[styles.pillDot, { backgroundColor: live > 0 ? colors.accentBright : colors.subtle }]} />
              <Text variant="caption" color={live > 0 ? colors.text : colors.muted}>{live === 0 ? "No one else live" : `${live} live`}</Text>
            </Glass>
          </Pressable>
        </View>

        {permission === "denied" ? (
          <View style={styles.notice}>
            <Text variant="body">Location is off, so the map can't follow you. Turn it on in Settings.</Text>
          </View>
        ) : null}

                {expanded ? (
          <View style={styles.controls} pointerEvents="box-none">
            <GlassButton testID="map-zoom-in" label="Zoom in" onPress={() => step(1)}>
              <Feather name="plus" size={20} color={colors.text} />
            </GlassButton>
            <GlassButton testID="map-zoom-out" label="Zoom out" onPress={() => step(-1)}>
              <Feather name="minus" size={20} color={colors.text} />
            </GlassButton>
            <GlassButton testID="map-view-toggle" label={view3d ? "Switch to 2D map" : "Switch to 3D map"} onPress={toggleView}>
              <Text variant="caption" bold>{view3d ? "2D" : "3D"}</Text>
            </GlassButton>
            <GlassButton testID="map-recenter" label="Back to my location" onPress={rehome}>
              <Feather name="navigation" size={19} color={follow ? colors.accentBright : colors.text} />
            </GlassButton>
          </View>
        ) : null}

        {expanded && selectedPosition && selectedInfo ? (
          <View style={styles.card} pointerEvents="box-none">
            <View style={styles.cardBody}>
              <Avatar handle={selectedInfo.handle} path={selectedInfo.avatarPath} size={44} ring={crewStyle(selectedInfo.styleIndex).tint} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="headline" numberOfLines={1}>@{selectedInfo.handle}</Text>
                <View style={styles.cardMeta}>
                  <View style={[styles.statusDot, { backgroundColor: colors.accentBright }]} />
                  <Text variant="caption" color={colors.muted} numberOfLines={1}>Live  ·  {selectedInfo.crewNames.join(", ")}</Text>
                </View>
              </View>
              <Pressable testID="map-card-follow" accessibilityRole="button" accessibilityLabel={followMember ? "Stop following" : "Follow"} onPress={() => setFollowMember((v) => !v)} style={[styles.cardButton, followMember && { backgroundColor: colors.accentSoft, borderColor: colors.accentBright }]}>
                <Text variant="caption" bold color={followMember ? colors.accentBright : colors.text}>{followMember ? "Following" : "Follow"}</Text>
              </Pressable>
              <Pressable testID="map-card-close" accessibilityRole="button" accessibilityLabel="Close" onPress={closeCard} hitSlop={8}>
                <Feather name="x" size={18} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={[StyleSheet.absoluteFill, { paddingBottom: SHEET_OVERLAP }]} pointerEvents="box-none">
          <Slot name="map.overlay" />
        </View>
      </Animated.View>

      <Glass kind="sheet" style={styles.sheet}>
        <Pressable testID="map-sheet-handle" accessibilityRole="button" accessibilityLabel={expanded ? "Show members" : "Show map"} onPress={() => { Haptics.selectionAsync().catch(() => undefined); setExpanded((v) => !v); }} style={styles.handleHit}>
          <View style={styles.handle} />
        </Pressable>
        <View style={styles.sheetHeader}>
          <Text variant="title">Crew</Text>
          {expanded ? (
            <Text variant="caption" muted>
              {members.length === 0 ? "No members on the map" : `${live} live  ·  ${members.length} ${members.length === 1 ? "member" : "members"}`}
            </Text>
          ) : (
            <View style={{ flexDirection: "row", gap: 8, alignSelf: "center" }}>
              <GlassButton testID="map-view-toggle" label={view3d ? "Switch to 2D map" : "Switch to 3D map"} size={36} onPress={toggleView}>
                <Text variant="caption" bold>{view3d ? "2D" : "3D"}</Text>
              </GlassButton>
              <GlassButton testID="map-recenter" label="Back to my location" size={36} onPress={rehome}>
                <Feather name="navigation" size={16} color={follow ? colors.accentBright : colors.text} />
              </GlassButton>
            </View>
          )}
        </View>
        <ScrollView
          testID="map-members"
          style={styles.list}
          contentContainerStyle={styles.listContent}
          alwaysBounceVertical
          scrollEventThrottle={16}
          onScroll={onListScroll}
          onScrollEndDrag={onListRelease}
        >
          {members.length === 0 && crewState.loaded ? (
            <Text variant="body" muted>{crewState.selected.length === 0 ? "Switch on a crew in Crews to see its members." : "Your crews have no other members yet."}</Text>
          ) : null}
          {members.map((m, i) => {
            const tint = crewStyle(m.styleIndex).tint;
            const position = m.position;
            const fresh = position ? now - position.ts <= FADE_AFTER_MS : false;
            return (
              <Pressable
                key={m.id}
                testID={`map-member-${m.handle}`}
                accessibilityRole="button"
                accessibilityLabel={position ? `Show ${m.handle} on the map` : `${m.handle} is not live`}
                disabled={!position}
                onPress={() => {
                  if (!position) return;
                  Haptics.selectionAsync().catch(() => undefined);
                  jumpTo(m.id, position.lat, position.lng);
                }}
                style={({ pressed }) => [styles.member, i > 0 && styles.memberDivider, pressed && { backgroundColor: colors.press }, !position && { opacity: 0.55 }]}
              >
                <Avatar handle={m.handle} path={m.avatarPath} size={40} ring={tint} />
                <View style={{ flex: 1 }}>
                  <Text variant="headline" numberOfLines={1}>@{m.handle}</Text>
                  <Text variant="caption" color={colors.muted} numberOfLines={1}>{m.crewNames.join(", ")}</Text>
                </View>
                <CarIcon icon={m.carIcon} size={22} color={position ? colors.muted : colors.disabled} />
                {position ? (
                  <View style={styles.status}>
                    {fresh && position.speedKmh !== null && position.speedKmh !== undefined ? (
                      position.speedKmh < 3 ? (
                        <Text variant="caption" color={colors.muted}>Parked</Text>
                      ) : (
                        <View style={styles.speed}>
                          <Text variant="numeral" style={{ fontSize: 18, lineHeight: 22 }}>{position.speedKmh}</Text>
                          <Text variant="caption" color={colors.subtle}>km/h</Text>
                        </View>
                      )
                    ) : (
                      <>
                        <View style={[styles.statusDot, { backgroundColor: fresh ? colors.accentBright : colors.subtle }]} />
                        <Text variant="caption" color={fresh ? colors.text : colors.subtle}>{fresh ? "Live" : "Idle"}</Text>
                      </>
                    )}
                  </View>
                ) : (
                  <Text variant="caption" color={colors.subtle}>Offline</Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  mapArea: { backgroundColor: colors.background },
  top: { position: "absolute", top: 60, left: 16, right: 80, alignItems: "flex-start" },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingHorizontal: 12, borderRadius: radii.pill },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  notice: { position: "absolute", top: 104, left: 16, right: 16, padding: 14, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  controls: { position: "absolute", right: 16, bottom: SHEET_OVERLAP + 96, gap: 12 },
  sheet: { flex: 1, marginTop: -SHEET_OVERLAP, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, borderBottomWidth: 0 },
  handleHit: { alignItems: "center", paddingTop: 8, paddingBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.28)" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8, minHeight: 44 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 8, paddingBottom: 96 },
  member: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingHorizontal: 12, borderRadius: radii.sm },
  memberDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  status: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 64, justifyContent: "flex-end" },
  speed: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  card: { position: "absolute", left: 16, right: 76, bottom: SHEET_OVERLAP + 92 },
  cardBody: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radii.xl, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardButton: { paddingHorizontal: 12, height: 32, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
});
