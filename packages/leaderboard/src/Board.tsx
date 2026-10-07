import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Avatar, Card, Disclaimer, Empty, Screen, Text, colors, crewStyle, messageFor, radii, useCrewState, useSession, useShell } from "@rdv/core";
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

  const podium = (rows ?? []).slice(0, 3);
  const rest = (rows ?? []).slice(3);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
      footer={<View style={{ paddingHorizontal: 20, paddingBottom: 96 }}><Disclaimer /></View>}
    >
      <View style={{ gap: 4 }}>
        <Text variant="large">Top speed</Text>
        <Text variant="body" muted>This week</Text>
        <Text variant="caption" color={colors.subtle}>Resets Monday</Text>
      </View>

      {crews.length === 0 ? (
        <Empty overline="Board" title="No crew on" body="Switch on a crew in Crews to see its board." />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, alignItems: "flex-start" }}>
            {crews.map((crew) => {
              const on = crew.id === crewId;
              const style = crewStyle(crew.styleIndex);
              return (
                <Pressable key={crew.id} testID={`board-crew-${crew.name}`} accessibilityRole="button" onPress={() => setCrewId(crew.id)} style={[styles.pill, on && { borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.12)" }]}>
                  <View style={[styles.dot, { backgroundColor: style.tint }]} />
                  <Text variant="caption" color={on ? colors.text : colors.muted}>{crew.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {error ? <Text color={colors.danger}>{error}</Text> : null}
          {rows && rows.length === 0 ? (
            <Empty overline="This week" title="No sessions this week" body="Go live to get on the board." />
          ) : (
            <>
              {podium.length > 0 ? (
                <View style={styles.podium}>
                  {[podium[1], podium[0], podium[2]].map((row, slot) => {
                    if (!row) return <View key={slot} style={{ flex: 1 }} />;
                    const first = row.rank === 1;
                    return (
                      <View key={row.user_id} testID={`board-row-${row.handle}`} style={[styles.podiumCol, first && { flex: 1.25 }]}>
                        <Text variant="label" color={colors.subtle}>{row.rank}</Text>
                        <Avatar handle={row.handle} path={row.avatar_path} size={first ? 64 : 48} />
                        <Text variant={first ? "numeralXL" : "numeral"} style={first ? undefined : { fontSize: 32, lineHeight: 32 }}>{Math.round(row.top_speed_kmh)}</Text>
                        <Text variant="caption" color={colors.subtle}>km/h</Text>
                        {first ? <View style={styles.bar} /> : null}
                        <Text variant="headline" numberOfLines={1} style={{ fontSize: 15, maxWidth: 96, textAlign: "center" }}>@{row.handle}</Text>
                        {row.user_id === me ? <Text variant="caption" muted>You</Text> : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {rest.length > 0 ? (
                <Card>
                  {rest.map((row, i) => (
                    <View key={row.user_id} testID={`board-row-${row.handle}`} style={[styles.row, i > 0 && styles.divider, row.user_id === me && { backgroundColor: colors.raised }]}>
                      {row.user_id === me ? <View style={styles.meBar} /> : null}
                      <Text variant="numeral" style={styles.rank} color={colors.subtle}>{row.rank}</Text>
                      <Avatar handle={row.handle} path={row.avatar_path} size={36} />
                      <View style={{ flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                        <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>@{row.handle}</Text>
                        {row.user_id === me ? <Text variant="caption" muted>You</Text> : null}
                      </View>
                      <Text variant="numeral">{Math.round(row.top_speed_kmh)}</Text>
                      <Text variant="caption" color={colors.subtle} style={styles.unit}>km/h</Text>
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          )}
          {selected ? <Text variant="caption" color={colors.subtle}>Speeds are measured by each person's phone and shown for sessions shared with {selected.name}.</Text> : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: "rgba(255,255,255,0.05)" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  podium: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingVertical: 20, paddingHorizontal: 12, borderRadius: radii.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.s1 },
  podiumCol: { flex: 1, alignItems: "center", gap: 6 },
  bar: { width: 24, height: 2, borderRadius: 1, backgroundColor: colors.accentBright },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 56 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  meBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 2, backgroundColor: colors.accentBright },
  rank: { width: 24, fontSize: 15 },
  unit: { width: 32 },
});
