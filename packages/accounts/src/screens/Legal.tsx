import { ScrollView, View } from "react-native";
import { DISCLAIMER_FULL, Screen, Text } from "@rdv/core";

export function LegalText() {
  return (
    <ScrollView>
      <View style={{ gap: 14 }}>
        {DISCLAIMER_FULL.map((item, i) => (
          <View key={item.title} style={{ gap: 2 }}>
            <Text bold>{`${i + 1}. ${item.title}`}</Text>
            <Text variant="body" muted>{item.body}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function Legal() {
  return (
    <Screen scroll={false} topInset={false}>
      <LegalText />
    </Screen>
  );
}
