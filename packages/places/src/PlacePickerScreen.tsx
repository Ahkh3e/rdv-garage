import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Glass, Screen, colors, radii, type Place } from "@rdv/core";
import { useController } from "./context";
import { SearchField, SearchResults, useSearch } from "./SearchResults";

export function PlacePickerScreen() {
  const navigation = useNavigation<any>();
  const controller = useController();
  const search = useSearch();
  useEffect(() => () => controller.finishPick(null), [controller]);

  const choose = (place: Place) => {
    controller.finishPick(place);
    navigation.goBack();
  };

  return (
    <Screen scroll={false} padded={false} topInset={false}>
      <View style={styles.pad}>
        <Glass kind="control" style={styles.field}>
          <SearchField search={search} autoFocus />
        </Glass>
      </View>
      <SearchResults search={search} onChoose={choose} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  field: { borderRadius: radii.pill, backgroundColor: colors.surface },
});
