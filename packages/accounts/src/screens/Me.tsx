import { Alert, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar, Card, Divider, Row, Screen, Text, colors, useShell, useSession } from "@rdv/core";

export function Me({ navigation }: { navigation: any }) {
  const shell = useShell();
  const session = useSession();
  if (session.status !== "signedIn") return null;
  const { profile } = session;
  const items = [...shell.menu].sort((a, b) => a.order - b.order);
  const icon = (name: string) => <Ionicons name={name as any} size={20} color={colors.muted} />;
  const chevron = <Ionicons name="chevron-forward" size={18} color={colors.muted} />;

  return (
    <Screen>
      <View style={{ alignItems: "center", gap: 10, paddingVertical: 12 }}>
        <Avatar handle={profile.handle} path={profile.avatarPath} size={88} />
        <Text variant="title">@{profile.handle}</Text>
      </View>
      <Card>
        <Row testID="me-edit" title="Edit profile" left={icon("person-outline")} right={chevron} onPress={() => navigation.navigate("EditProfile")} />
        <Divider />
        <Row title="Change password" left={icon("key-outline")} right={chevron} onPress={() => navigation.navigate("ChangePassword")} />
        <Divider />
        <Row testID="me-devices" title="Devices" left={icon("phone-portrait-outline")} right={chevron} onPress={() => navigation.navigate("Devices")} />
        {items.map((item) => (
          <View key={item.id}>
            <Divider />
            <Row testID={`me-${item.id}`} title={item.title} left={icon(item.icon)} right={chevron} onPress={() => navigation.navigate(item.route)} />
          </View>
        ))}
        <Divider />
        <Row title="Safety terms" left={icon("shield-checkmark-outline")} right={chevron} onPress={() => navigation.navigate("Legal")} />
      </Card>
      <Card>
        <Row
          testID="me-signout"
          title="Sign out"
          left={icon("log-out-outline")}
          onPress={() => Alert.alert("Sign out?", "You'll need your email and password to sign back in.", [
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: () => shell.backend.auth.signOut() },
          ])}
        />
        <Divider />
        <Row testID="me-delete" title="Delete account" danger left={<Ionicons name="trash-outline" size={20} color={colors.danger} />} onPress={() => navigation.navigate("DeleteAccount")} />
      </Card>
    </Screen>
  );
}
