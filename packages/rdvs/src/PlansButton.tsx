import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { GlassButton, colors, useShell } from "@rdv/core";
import { PLANS_ROUTE } from "./controller";

export function PlansButton() {
  const shell = useShell();
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <GlassButton testID="rdv-plans" label="Plans" onPress={() => shell.navigate(PLANS_ROUTE)}>
        <Feather name="calendar" size={19} color={colors.text} />
      </GlassButton>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { position: "absolute", top: 152, right: 16 } });
