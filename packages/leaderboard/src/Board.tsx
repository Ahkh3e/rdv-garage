import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Avatar, Card, Disclaimer, Empty, Screen, Text, colors, crewStyle, formatDaySet, messageFor, radii, useCrewState, useSession, useShell } from "@rdv/core";
import { Pressable } from "react-native";

interface Row {
  rank: number;
  user_id: string;
  handle: string;
  avatar_path: string | null;
  top_speed_kmh: number;
  set_on: string;
}

export function Board() {
  const shell = useShell();
  const session = useSession();
  const crewState = useCrewState();
  const crews = crewState.crews.filter((c) => c.selected);
  const [crewId, setCrewId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const me = session.status === "signedIn" ? session.userId : null;

  useEffect(() => {
    if (!crewId || !crews.some((c) => c.id === crewId)) setCrewId(crews[0]?.id ?? null);
  }, [crews.map((c) => c.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = useRef(0);
  const load = useCallback(async () => {
    if (!crewId) return setRows(null);
    const ticket = ++latest.current;
    try {
      const result = await shell.backend.rpc<Row[]>("leaderboard", "weekly_top_speed", { p_crew: crewId });
      // A slower answer for a crew the person already switched away from must not overwrite the current board.
      if (ticket === latest.current) {
        setRows(result);
        setError(null);
      }
    } catch (e) {
      if (ticket === latest.current) setError(messageFor(e));
    }
  }, [shell, crewId]);
  useEffect(() => setRows(null), [crewId]);

  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, 30000);
      return () => clearInterval(timer);
    }, [load]),
  );

  const selected = crews.find((c) => c.id === crewId);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
      footer={<View style={{ padding: 16 }}><Disclaimer /></View>}
    >
      <View>
        <Text variant="large">Top speed</Text>
        <Text muted>This week · Resets Monday</Text>
      </View>

      {crews.length === 0 ? (
        <Empty icon="trophy-outline" title="No crew on" body="Switch on a crew in Crews to see its board." />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, alignItems: "flex-start" }}>
            {crews.map((crew) => {
              const on = crew.id === crewId;
              const style = crewStyle(crew.styleIndex);
              return (
                <Pressable key={crew.id} testID={`board-crew-${crew.name}`} accessibilityRole="button" onPress={() => setCrewId(crew.id)} style={[styles.pill, on && { borderColor: style.tint, backgroundColor: colors.raised }]}>
                  <View style={[styles.dot, { backgroundColor: style.tint }]} />
                  <Text variant="body" bold={on}>{crew.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {error ? <Text color={colors.danger}>{error}</Text> : null}
          {rows && rows.length === 0 ? (
            <Empty icon="speedometer-outline" title="No sessions this week" body="Go live to get on the board." />
          ) : (
            <Card>
              {(rows ?? []).map((row, i) => (
                <View key={row.user_id} testID={`board-row-${row.handle}`} style={[styles.row, i > 0 && styles.divider, row.user_id === me && { backgroundColor: colors.raised }]}>
                  <Text variant="mono" style={styles.rank} muted={row.rank > 1} color={row.rank === 1 ? colors.accent : undefined}>{row.rank}</Text>
                  <Avatar handle={row.handle} path={row.avatar_path} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1}>@{row.handle}{row.user_id === me ? "  (you)" : ""}</Text>
                    <Text variant="caption" muted>{formatDaySet(row.set_on)}</Text>
                  </View>
                  <Text variant="mono" style={{ fontSize: 20 }}>{Math.round(row.top_speed_kmh)}<Text variant="caption" muted> km/h</Text></Text>
                </View>
              ))}
            </Card>
          )}
          {selected ? <Text variant="caption" muted>Speeds are measured by each person's phone and shown for sessions shared with {selected.name}.</Text> : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, minHeight: 40, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rank: { width: 24, textAlign: "center" },
});
