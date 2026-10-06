import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Empty, Screen, Text, Toggle, colors, crewStyle, messageFor, useCrewState, useShell } from "@rdv/core";
import { loadCrews } from "../data";

export function CrewsHome({ navigation }: { navigation: any }) {
  const shell = useShell();
  const state = useCrewState();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await loadCrews(shell);
      setError(null);
    } catch (e) {
      setError(messageFor(e));
    }
  }, [shell]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const timer = setInterval(refresh, 30000);
      return () => clearInterval(timer);
    }, [refresh]),
  );
  useEffect(() => void refresh(), [refresh]);

  const toggle = (id: string, on: boolean) => {
    const next = on ? [...new Set([...state.selected, id])] : state.selected.filter((x) => x !== id);
    shell.crewContext.select(next);
  };

  const actions = (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <Button title="Create crew" testID="crews-create" style={{ flex: 1 }} onPress={() => navigation.navigate("CreateCrew")} />
      <Button title="Join with link" testID="crews-join" variant="secondary" style={{ flex: 1 }} onPress={() => navigation.navigate("JoinCrew")} />
    </View>
  );

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }}>
      <Text variant="large">Crews</Text>
      {error ? <Text color={colors.danger}>{error}</Text> : null}
      {state.loaded && state.crews.length === 0 ? (
        <Empty icon="people-outline" title="No crews yet" body="Create a crew, or open a crew link someone shared with you." action={actions} />
      ) : (
        <>
          <Text variant="caption" muted>The map and the board show the crews you switch on.</Text>
          {state.crews.map((crew) => {
            const style = crewStyle(crew.styleIndex);
            const liveCount = crew.members.filter((m) => m.live).length;
            return (
              <Card key={crew.id}>
                <Pressable testID={`crew-${crew.name}`} accessibilityRole="button" onPress={() => navigation.navigate("CrewDetail", { id: crew.id })} style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }}>
                  <View style={{ width: 12, alignSelf: "stretch", borderRadius: 6, backgroundColor: style.tint }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="title" numberOfLines={1}>{crew.name}</Text>
                    <Text variant="caption" muted>
                      {crew.members.length} {crew.members.length === 1 ? "member" : "members"}
                      {liveCount > 0 ? `  ·  ${liveCount} live` : ""}
                    </Text>
                  </View>
                  {liveCount > 0 ? <Ionicons name="radio-outline" size={18} color={colors.accent} /> : null}
                  <Toggle accessibilityLabel={`Show ${crew.name}`} value={crew.selected} onChange={(v) => toggle(crew.id, v)} />
                </Pressable>
              </Card>
            );
          })}
          {actions}
        </>
      )}
    </Screen>
  );
}
