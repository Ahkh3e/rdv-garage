import { Button, Empty, Screen } from "@rdv/core";

const COPY: Record<string, string> = {
  expired: "That invite has expired. Invites last 24 hours.",
  revoked: "That invite is no longer active.",
  disabled: "That invite is no longer active.",
  invalid: "We don't recognize that invite.",
};

export function InviteExpired({ navigation, route }: { navigation: any; route: { params?: { status?: string } } }) {
  const status = route.params?.status ?? "invalid";
  return (
    <Screen>
      <Empty
        icon="time-outline"
        title="Invite not available"
        body={`${COPY[status] ?? COPY.invalid} Ask the person who shared it for a new invite.`}
        action={<Button title="Try another code" variant="secondary" onPress={() => navigation.navigate("EnterInvite")} />}
      />
    </Screen>
  );
}
