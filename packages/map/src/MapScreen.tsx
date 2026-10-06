import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Camera, Map, ViewAnnotation, type CameraRef } from "@maplibre/maplibre-react-native";
import { Chip, Slot, Text, colors, radii, useCrewState, usePositions, useSession, useShell } from "@rdv/core";
import { MemberMarker, SelfMarker } from "./MemberMarker";
import { FOLLOW_CAMERA, rdvNightStyle } from "./style";

const TORONTO: [number, number] = [-79.3832, 43.6532];
const FADE_AFTER_MS = 45000;
const BOTTOM_PADDING = 170;

interface Me {
  lat: number;
  lng: number;
  heading: number | null;
}

export function MapScreen() {
  const shell = useShell();
  const focused = useIsFocused();
  const session = useSession();
  const crewState = useCrewState();
  const positions = usePositions();
  const camera = useRef<CameraRef>(null);
  const lastHeading = useRef(0);
  const [follow, setFollow] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

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
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 1000 }, (loc) => {
        const moving = (loc.coords.speed ?? 0) > 2 && loc.coords.heading !== null && loc.coords.heading >= 0;
        setMe({ lat: loc.coords.latitude, lng: loc.coords.longitude, heading: moving ? loc.coords.heading : null });
      });
    })();
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [focused]);

  // Follow mode, Waze style: tilted, close behind you, turning with the road. The camera keeps your last heading when you stop.
  useEffect(() => {
    if (!follow || !me || !camera.current) return;
    if (me.heading !== null) lastHeading.current = me.heading;
    camera.current.easeTo({
      center: [me.lng, me.lat],
      zoom: FOLLOW_CAMERA.zoom,
      pitch: FOLLOW_CAMERA.pitch,
      bearing: lastHeading.current,
      padding: { top: 0, right: 0, bottom: BOTTOM_PADDING, left: 0 },
      duration: 700,
      easing: "linear",
    });
  }, [me, follow]);

  const lookup = useMemo(() => {
    const map = new globalThis.Map<string, { handle: string; avatarPath: string | null; styleIndex: number }>();
    for (const crew of crewState.crews) {
      for (const member of crew.members) {
        if (!map.has(member.userId) || crewState.selected.includes(crew.id)) {
          map.set(member.userId, { handle: member.handle, avatarPath: member.avatarPath, styleIndex: crew.styleIndex });
        }
      }
    }
    return map;
  }, [crewState]);

  const myId = session.status === "signedIn" ? session.userId : null;
  const others = Object.values(positions).filter(
    (p) => p.userId !== myId && p.crewIds.some((id) => crewState.selected.includes(id)) && lookup.has(p.userId),
  );

  return (
    <View style={styles.root}>
      <Map
        testID="map-view"
        style={StyleSheet.absoluteFill}
        mapStyle={rdvNightStyle}
        compass={false}
        logo={false}
        attribution
        attributionPosition={{ bottom: 100, left: 8 }}
        onRegionDidChange={(event) => {
          // Dragging or pinching the map by hand ends follow mode; the recenter button brings it back.
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
        <Chip label={others.length === 0 ? "No one else live" : `${others.length} live`} selected={others.length > 0} />
        {crewState.selected.length === 0 && crewState.loaded ? (
          <Pressable onPress={() => shell.navigate("Tabs")}>
            <Text variant="caption" muted>Switch on a crew in Crews to see its members.</Text>
          </Pressable>
        ) : null}
      </View>

      {permission === "denied" ? (
        <View style={styles.notice}>
          <Text variant="body">Location is off, so the map can't follow you. Turn it on in Settings.</Text>
        </View>
      ) : null}

      {!follow ? (
        <Pressable testID="map-recenter" accessibilityRole="button" accessibilityLabel="Recenter" onPress={() => setFollow(true)} style={styles.recenter}>
          <Ionicons name="navigate" size={22} color={colors.text} />
        </Pressable>
      ) : null}

      <Slot name="map.overlay" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { position: "absolute", top: 56, left: 16, right: 16, gap: 8, alignItems: "flex-start" },
  notice: { position: "absolute", top: 100, left: 16, right: 16, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  recenter: { position: "absolute", right: 16, bottom: 110, width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
});
