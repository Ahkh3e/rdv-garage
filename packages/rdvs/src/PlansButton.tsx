import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { GlassButton, colors, useMapTops, useShell } from "@rdv/core";
import { PLANS_ROUTE } from "./controller";

export function PlansButton() {
  const shell = useShell();
  const tops = useMapTops();
  return (
    <View style={[styles.wrap, { top: tops.search }]} pointerEvents="box-none">
      <GlassButton testID="rdv-plans" label="Plans" onPress={() => shell.navigate(PLANS_ROUTE)}>
        <Feather name="calendar" size={19} color={colors.text} />
      </GlassButton>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { position: "absolute", right: 16 } });
