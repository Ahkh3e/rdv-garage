import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Button, Card, Divider, Empty, PulseDot, Screen, Text, Toggle, colors, crewStyle, messageFor, useCrewState, useShell } from "@rdv/core";
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
    <View style={{ gap: 8 }}>
      <Button title="Create crew" testID="crews-create" onPress={() => navigation.navigate("CreateCrew")} />
      <Button title="Join with a link" testID="crews-join" variant="ghost" onPress={() => navigation.navigate("JoinCrew")} />
    </View>
  );

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }}>
      <View style={{ gap: 4 }}>
        <Text variant="large">Crews</Text>
        <Text variant="body" muted>Shown on the map and the board.</Text>
      </View>
      {error ? <Text color={colors.danger}>{error}</Text> : null}
      {state.loaded && state.crews.length === 0 ? (
        <Empty overline="Crews" title="No crews yet" body="Create a crew, or open a crew link someone shared with you. Crews are private: only members see each other." action={actions} />
      ) : (
        <>
          <Card>
            {state.crews.map((crew, i) => {
              const style = crewStyle(crew.styleIndex);
              const liveCount = crew.members.filter((m) => m.live).length;
              return (
                <View key={crew.id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable testID={`crew-${crew.name}`} accessibilityRole="button" onPress={() => navigation.navigate("CrewDetail", { id: crew.id })} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, minHeight: 72 }, pressed && { backgroundColor: colors.press }]}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: style.tint }} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="headline" numberOfLines={1}>{crew.name}</Text>
                      <Text variant="caption" muted>
                        {crew.members.length} {crew.members.length === 1 ? "member" : "members"}
                        {liveCount > 0 ? `  ·  ${liveCount} live` : ""}
                      </Text>
                    </View>
                    {liveCount > 0 ? <PulseDot size={6} halo={3} /> : null}
                    <View style={{ justifyContent: "center", alignSelf: "stretch" }}>
                      <Toggle accessibilityLabel={`Show ${crew.name}`} value={crew.selected} onChange={(v) => toggle(crew.id, v)} />
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </Card>
          {actions}
        </>
      )}
    </Screen>
  );
}
