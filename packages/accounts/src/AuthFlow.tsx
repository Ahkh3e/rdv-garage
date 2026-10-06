import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { GlassButton, colors, fonts } from "@rdv/core";
import { ConfirmEmail } from "./screens/ConfirmEmail";
import { CreateAccount } from "./screens/CreateAccount";
import { EnterInvite } from "./screens/EnterInvite";
import { ForgotPassword } from "./screens/ForgotPassword";
import { InviteExpired } from "./screens/InviteExpired";
import { SignIn } from "./screens/SignIn";
import { Welcome } from "./screens/Welcome";

const Stack = createNativeStackNavigator();

export function AuthFlow() {
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
        headerLeft: () => (
          <GlassButton label="Back" onPress={() => navigation.goBack()}>
            <Feather name="chevron-left" size={22} color={colors.text} />
          </GlassButton>
        ),
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.semibold },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        title: "",
      })}
    >
      <Stack.Screen name="Welcome" component={Welcome} options={{ headerShown: false }} />
      <Stack.Screen name="EnterInvite" component={EnterInvite} />
      <Stack.Screen name="InviteExpired" component={InviteExpired} />
      <Stack.Screen name="CreateAccount" component={CreateAccount as never} />
      <Stack.Screen name="ConfirmEmail" component={ConfirmEmail as never} />
      <Stack.Screen name="SignIn" component={SignIn as never} />
      <Stack.Screen name="ForgotPassword" component={ForgotPassword as never} />
    </Stack.Navigator>
  );
}
