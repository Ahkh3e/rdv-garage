import { useState } from "react";
import { View } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Avatar, Banner, Button, Input, Screen, Text, colors, useAction, useShell, useSession } from "@rdv/core";

export function EditProfile({ navigation }: { navigation: any }) {
  const shell = useShell();
  const session = useSession();
  const profile = session.status === "signedIn" ? session.profile : null;
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [saved, setSaved] = useState(false);

  const refresh = async () => {
    const rows = await shell.backend.rpc<{ id: string; handle: string; avatar_path: string | null; car_icon?: string; car_color?: string | null }[]>("accounts", "my_profile");
    const row = rows[0];
    if (row) shell.session.set({ status: "signedIn", userId: row.id, profile: { id: row.id, handle: row.handle, avatarPath: row.avatar_path, carIcon: row.car_icon ?? "gt", carColor: row.car_color ?? null } });
  };

  const saveHandle = useAction(async () => {
    await shell.backend.rpc("accounts", "update_profile", { p_handle: handle.trim().toLowerCase() });
    await refresh();
    setSaved(true);
  });

  const pickAvatar = useAction(async () => {
    if (!profile) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const context = ImageManipulator.ImageManipulator.manipulate(result.assets[0].uri);
    const rendered = await context.resize({ width: 512 }).renderAsync();
    const out = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 });
    const data = await (await fetch(out.uri)).arrayBuffer();
    const path = await shell.backend.uploadAvatar(profile.id, data, "image/jpeg");
    await shell.backend.rpc("accounts", "update_profile", { p_avatar_path: path });
    await refresh();
  });

  const removeAvatar = useAction(async () => {
    await shell.backend.rpc("accounts", "update_profile", { p_clear_avatar: true });
    await refresh();
  });

  if (!profile) return null;
  return (
    <Screen>
      <View style={{ alignItems: "center", gap: 12 }}>
        <Avatar handle={profile.handle} path={profile.avatarPath} size={110} />
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Button title="Choose photo" variant="secondary" loading={pickAvatar.loading} onPress={() => pickAvatar.run()} />
          {profile.avatarPath ? <Button title="Remove" variant="ghost" loading={removeAvatar.loading} onPress={() => removeAvatar.run()} /> : null}
        </View>
        {pickAvatar.error ? <Text color={colors.danger}>{pickAvatar.error}</Text> : null}
      </View>
      <Input testID="edit-handle" label="Handle" autoCapitalize="none" autoCorrect={false} value={handle} onChangeText={(t) => { setHandle(t); setSaved(false); }} error={saveHandle.error} hint="You can change your handle once every 30 days." />
      {saved ? <Banner text="Saved." /> : null}
      <Button title="Save handle" testID="edit-save" loading={saveHandle.loading} disabled={handle === profile.handle || handle.length < 3} onPress={() => saveHandle.run()} />
      <Button title="Done" variant="ghost" onPress={() => navigation.goBack()} />
    </Screen>
  );
}
