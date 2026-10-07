import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Spinner, Text, colors, messageFor, useShell, useStore, type Place } from "@rdv/core";
import { AppError } from "@rdv/core";
import { createSearch, type Search } from "./search";
import { recents } from "./native";
import { queryReady } from "./validation";

export function useSearch(): Search {
  const shell = useShell();
  const search = useMemo(() => createSearch(shell.geocoder, () => shell.mapBridge.view.get()), [shell]);
  useEffect(() => () => search.reset(), [search]);
  return search;
}

export function SearchField({ search, onFocus, onClear, autoFocus }: { search: Search; onFocus?: () => void; onClear?: () => void; autoFocus?: boolean }) {
  const { query } = useStore(search.state);
  return (
    <View style={styles.field}>
      <Feather name="search" size={16} color={colors.muted} />
      <TextInput
        testID="places-search-input"
        value={query}
        onChangeText={search.setQuery}
        onFocus={onFocus}
        autoFocus={autoFocus}
        placeholder="Search places and addresses"
        placeholderTextColor={colors.subtle}
        selectionColor={colors.accent}
        keyboardAppearance="dark"
        returnKeyType="search"
        autoCorrect={false}
        style={styles.input}
      />
      {query ? (
        <Pressable testID="places-search-clear" accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} onPress={() => { search.reset(); onClear?.(); }}>
          <Feather name="x" size={16} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function SearchResults({ search, onChoose }: { search: Search; onChoose: (place: Place) => void }) {
  const state = useStore(search.state);
  const saved = useStore(recents.store);

  if (!queryReady(state.query)) {
    if (saved.length === 0) return <Text variant="caption" muted style={styles.pad}>Type at least 3 characters.</Text>;
    return (
      <View>
        <View style={styles.recentHead}>
          <Text variant="label" color={colors.subtle}>Recent</Text>
          <Pressable testID="places-recents-clear" accessibilityRole="button" onPress={recents.clear} hitSlop={8}>
            <Text variant="caption" color={colors.muted}>Clear</Text>
          </Pressable>
        </View>
        {saved.map((text) => (
          <Pressable key={text} testID={`places-recent-${text}`} accessibilityRole="button" onPress={() => search.setQuery(text)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.press }]}>
            <Feather name="clock" size={15} color={colors.subtle} />
            <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>{text}</Text>
          </Pressable>
        ))}
      </View>
    );
  }
  if (state.status === "error") return <Text variant="body" color={colors.danger} style={styles.pad}>{messageFor(new AppError(state.error ?? "unknown_error"))}</Text>;
  if (state.status === "loading" && state.results.length === 0) return <View style={styles.pad}><Spinner /></View>;
  if (state.status === "done" && state.results.length === 0) {
    return (
      <View style={styles.pad} testID="places-empty">
        <Text variant="headline">No places for “{state.query.trim()}”</Text>
        <Text variant="caption" muted>Try a shorter search, or press and hold the map to drop a pin by hand.</Text>
      </View>
    );
  }
  return (
    <View>
      {state.results.map((place, i) => (
        <Pressable
          key={`${place.lat}-${place.lng}-${i}`}
          testID={`places-result-${i}`}
          accessibilityRole="button"
          onPress={() => {
            recents.add(state.query);
            onChoose(place);
          }}
          style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && { backgroundColor: colors.press }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline" numberOfLines={1}>{place.name}</Text>
            <Text variant="caption" color={colors.muted} numberOfLines={1}>{[place.kind, place.address].filter(Boolean).join("  ·  ")}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, height: 44, paddingHorizontal: 14 },
  input: { flex: 1, color: colors.text, fontSize: 15, height: 44 },
  pad: { padding: 16, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  recentHead: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12 },
});
