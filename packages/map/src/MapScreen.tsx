import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { Camera, Map, ViewAnnotation, type CameraRef } from "@maplibre/maplibre-react-native";
import { Avatar, Glass, GlassButton, Slot, Text, colors, crewStyle, radii, useCrewState, usePositions, useSession } from "@rdv/core";
import { MemberMarker, SelfMarker } from "./MemberMarker";
import { FLAT_PITCH, FOLLOW_CAMERA, rdvNightStyle, rdvNightStyleFlat } from "./style";

const TORONTO: [number, number] = [-79.3832, 43.6532];
const FADE_AFTER_MS = 45000;
const EXPANDED = 0.75;
const COLLAPSED = 0.25;
const SHEET_OVERLAP = 20;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
const JUMP_ZOOM = 16;

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
  const [view3d, setView3d] = useState(true);
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
      const watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 1000 }, (loc) => {
        const moving = (loc.coords.speed ?? 0) > 2 && loc.coords.heading !== null && loc.coords.heading >= 0;
        setMe({ lat: loc.coords.latitude, lng: loc.coords.longitude, heading: moving ? loc.coords.heading : null });
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
    const map = new globalThis.Map<string, { handle: string; avatarPath: string | null; styleIndex: number; crewNames: string[] }>();
    for (const crew of crewState.crews) {
      if (!crewState.selected.includes(crew.id)) continue;
      for (const member of crew.members) {
        const known = map.get(member.userId);
        if (known) known.crewNames.push(crew.name);
        else map.set(member.userId, { handle: member.handle, avatarPath: member.avatarPath, styleIndex: crew.styleIndex, crewNames: [crew.name] });
      }
    }
    return map;
  }, [crewState]);

  const myId = session.status === "signedIn" ? session.userId : null;
  const others = Object.values(positions).filter(
    (p) => p.userId !== myId && p.crewIds.some((id) => crewState.selected.includes(id)) && lookup.has(p.userId),
  );

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

  const jumpTo = (lat: number, lng: number) => {
    setFollow(false);
    setExpanded(true);
    camera.current?.easeTo({ center: [lng, lat], zoom: JUMP_ZOOM, pitch: view3d ? 45 : FLAT_PITCH, bearing: 0, duration: 800 });
  };

  const rehome = () => {
    followZoom.current = FOLLOW_CAMERA.zoom;
    setFollow(true);
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
          testID="map-view"
          style={StyleSheet.absoluteFill}
          mapStyle={view3d ? rdvNightStyle : rdvNightStyleFlat}
          compass={false}
          logo={false}
          tintColor={colors.subtle}
          attribution
          attributionPosition={{ bottom: SHEET_OVERLAP + 6, left: 8 }}
          onRegionDidChange={(event) => {
            zoom.current = event.nativeEvent.zoom;
            // Dragging or pinching the map by hand ends follow mode; the home button brings it back.
            if (event.nativeEvent.userInteraction) setFollow(false);
          }}
        >
          <Camera ref={camera} initialViewState={{ center: TORONTO, zoom: 11.5 }} />
          {me ? (
            <ViewAnnotation id="me" lngLat={[me.lng, me.lat]} anchor="center">
              <SelfMarker following={follow} />
            </ViewAnnotation>
          ) : null}
          {others.map((p) => {
            const info = lookup.get(p.userId)!;
            return (
              <ViewAnnotation key={p.userId} id={p.userId} lngLat={[p.lng, p.lat]} anchor="center">
                <MemberMarker handle={info.handle} avatarPath={info.avatarPath} styleIndex={info.styleIndex} stale={now - p.ts > FADE_AFTER_MS} />
              </ViewAnnotation>
            );
          })}
        </Map>

        <View style={styles.top} pointerEvents="box-none">
          <Pressable testID="map-show-everyone" accessibilityRole="button" accessibilityLabel="Show everyone live" onPress={showEveryone}>
            <Glass kind="control" style={styles.pill}>
              <View style={[styles.pillDot, { backgroundColor: live > 0 ? colors.accent : colors.subtle }]} />
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
              <Feather name="navigation" size={19} color={follow ? colors.accent : colors.text} />
            </GlassButton>
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
                <Feather name="navigation" size={16} color={follow ? colors.accent : colors.text} />
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
                  jumpTo(position.lat, position.lng);
                }}
                style={({ pressed }) => [styles.member, i > 0 && styles.memberDivider, pressed && { backgroundColor: colors.press }, !position && { opacity: 0.55 }]}
              >
                <Avatar handle={m.handle} path={m.avatarPath} size={40} ring={tint} />
                <View style={{ flex: 1 }}>
                  <Text variant="headline" numberOfLines={1}>@{m.handle}</Text>
                  <Text variant="caption" color={colors.muted} numberOfLines={1}>{m.crewNames.join(", ")}</Text>
                </View>
                {position ? (
                  <View style={styles.status}>
                    <View style={[styles.statusDot, { backgroundColor: fresh ? colors.accent : colors.subtle }]} />
                    <Text variant="caption" color={fresh ? colors.text : colors.subtle}>{fresh ? "Live" : "Idle"}</Text>
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
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
});
