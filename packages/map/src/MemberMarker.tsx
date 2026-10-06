import { memo, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Marker } from "react-native-maps";
import { Text, colors, crewStyle, fonts, useAvatarUrl } from "@rdv/core";

interface Props {
  userId: string;
  handle: string;
  avatarPath: string | null;
  lat: number;
  lng: number;
  styleIndex: number;
  stale: boolean;
  self?: boolean;
}

const SIZE = 44;

function shapeStyle(index: number) {
  switch (crewStyle(index).shape) {
    case "square":
      return { borderRadius: 8 };
    case "diamond":
      return { borderRadius: 6, transform: [{ rotate: "45deg" }] };
    case "hexagon":
      return { borderRadius: 16 };
    case "triangle":
      return { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 };
    case "pill":
      return { borderRadius: 22, width: SIZE + 14 };
    default:
      return { borderRadius: SIZE / 2 };
  }
}

function MemberMarkerBase({ userId, handle, avatarPath, lat, lng, styleIndex, stale, self }: Props) {
  const url = useAvatarUrl(avatarPath);
  const [tracking, setTracking] = useState(true);
  const tint = self ? colors.accent : crewStyle(styleIndex).tint;
  const diamond = crewStyle(styleIndex).shape === "diamond" && !self;
  const shape = self ? { borderRadius: SIZE / 2 } : shapeStyle(styleIndex);
  return (
    <Marker
      identifier={userId}
      coordinate={{ latitude: lat, longitude: lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracking}
      zIndex={self ? 10 : 1}
    >
      <View style={[styles.wrap, { opacity: stale ? 0.45 : 1 }]}>
        <View style={[styles.ring, { borderColor: tint, width: SIZE, height: SIZE }, shape]}>
          <View style={diamond ? { transform: [{ rotate: "-45deg" }] } : undefined}>
            {url ? (
              <Image source={{ uri: url }} style={styles.photo} onLoad={() => setTracking(false)} />
            ) : (
              <View style={[styles.photo, styles.initial]}>
                <Text bold muted onLayout={() => setTimeout(() => setTracking(false), 300)}>{handle.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.label}>
          <Text variant="caption" bold numberOfLines={1} style={{ fontFamily: fonts.semibold }}>{self ? "You" : handle}</Text>
        </View>
      </View>
    </Marker>
  );
}

export const MemberMarker = memo(MemberMarkerBase);

const styles = StyleSheet.create({
  wrap: { alignItems: "center", minWidth: 70 },
  ring: { borderWidth: 3, alignItems: "center", justifyContent: "center", backgroundColor: colors.raised, overflow: "hidden" },
  photo: { width: SIZE - 8, height: SIZE - 8, borderRadius: (SIZE - 8) / 2 },
  initial: { alignItems: "center", justifyContent: "center", backgroundColor: colors.raised },
  label: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: "rgba(10,10,11,0.85)", maxWidth: 110 },
});
