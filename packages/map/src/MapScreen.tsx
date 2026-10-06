import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";
import { Chip, Slot, Text, colors, darkMapStyle, radii, useCrewState, usePositions, useSession, useShell } from "@rdv/core";
import { MemberMarker } from "./MemberMarker";

const TORONTO = { latitude: 43.6532, longitude: -79.3832, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const FADE_AFTER_MS = 45000;

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
  const mapRef = useRef<MapView>(null);
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
        setMe({ lat: loc.coords.latitude, lng: loc.coords.longitude, heading: loc.coords.heading !== null && loc.coords.heading >= 0 && (loc.coords.speed ?? 0) > 2 ? loc.coords.heading : null });
      });
    })();
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [focused]);

  useEffect(() => {
    if (!follow || !me || !mapRef.current) return;
    mapRef.current.animateCamera({ center: { latitude: me.lat, longitude: me.lng }, ...(me.heading !== null ? { heading: me.heading } : {}), zoom: 16 }, { duration: 600 });
  }, [me, follow]);

  const lookup = useMemo(() => {
    const map = new Map<string, { handle: string; avatarPath: string | null; styleIndex: number }>();
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
  const recenter = useCallback(() => setFollow(true), []);
  const myProfile = session.status === "signedIn" ? session.profile : null;

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        userInterfaceStyle="dark"
        customMapStyle={darkMapStyle}
        initialRegion={TORONTO}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        onPanDrag={() => setFollow(false)}
        mapPadding={{ top: 0, right: 0, bottom: 90, left: 0 }}
      >
        {me && myProfile ? (
          <MemberMarker self userId="me" handle={myProfile.handle} avatarPath={myProfile.avatarPath} lat={me.lat} lng={me.lng} styleIndex={0} stale={false} />
        ) : null}
        {others.map((p) => {
          const info = lookup.get(p.userId)!;
          return <MemberMarker key={p.userId} userId={p.userId} handle={info.handle} avatarPath={info.avatarPath} lat={p.lat} lng={p.lng} styleIndex={info.styleIndex} stale={now - p.ts > FADE_AFTER_MS} />;
        })}
      </MapView>

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
        <Pressable testID="map-recenter" accessibilityRole="button" accessibilityLabel="Recenter" onPress={recenter} style={styles.recenter}>
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
