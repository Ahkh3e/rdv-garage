import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Avatar, Button, Card, Divider, Input, Screen, Text, Toggle, colors, useAction, useCrewState, useSession } from "@rdv/core";
import { useController } from "./context";
import { membersOfCrews } from "./model";

export function NewRoom({ navigation }: { navigation: any }) {
  const controller = useController();
  const session = useSession();
  const crews = useCrewState().crews;
  const me = session.status === "signedIn" ? session.userId : null;
  const people = useMemo(() => membersOfCrews(crews, me), [crews, me]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const create = useAction(async () => {
    const id = await controller.createRoom(name.trim(), description, picked);
    navigation.replace("ChatRoom", { roomId: id });
  });
  const toggle = (id: string, on: boolean) => setPicked((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  return (
    <Screen>
      <Text variant="title">New room</Text>
      <Text muted>An invite-only room. You can add people who share a crew with you, from any of your crews.</Text>
      <Input testID="room-name" label="Name" value={name} onChangeText={setName} maxLength={30} placeholder="3 to 30 characters" />
      <Input testID="room-description" label="Description (optional)" value={description} onChangeText={setDescription} maxLength={140} />
      <Text variant="label" muted>Add people</Text>
      {people.length === 0 ? (
        <Text muted>Nobody to add yet. Join a crew to find people.</Text>
      ) : (
        <Card>
          {people.map((p, i) => (
            <View key={p.userId}>
              {i > 0 ? <Divider /> : null}
              <Pressable testID={`pick-${p.handle}`} accessibilityRole="button" onPress={() => toggle(p.userId, !picked.includes(p.userId))} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 64 }}>
                <Avatar handle={p.handle} path={p.avatarPath} />
                <View style={{ flex: 1 }}>
                  <Text variant="headline">@{p.handle}</Text>
                  <Text variant="caption" color={colors.muted} numberOfLines={1}>{p.crews.join(", ")}</Text>
                </View>
                <Toggle accessibilityLabel={`Add ${p.handle}`} value={picked.includes(p.userId)} onChange={(v) => toggle(p.userId, v)} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}
      {create.error ? <Text color={colors.danger}>{create.error}</Text> : null}
      <Button testID="room-create" title="Create room" loading={create.loading} disabled={name.trim().length < 3} onPress={() => create.run()} />
    </Screen>
  );
}
