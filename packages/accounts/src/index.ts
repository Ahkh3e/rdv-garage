import { Alert } from "react-native";
import type { Module } from "@rdv/core";
import { AuthFlow } from "./AuthFlow";
import { CarPicker } from "./screens/CarPicker";
import { ChangePassword } from "./screens/ChangePassword";
import { DeleteAccount } from "./screens/DeleteAccount";
import { Devices } from "./screens/Devices";
import { EditProfile } from "./screens/EditProfile";
import { Legal } from "./screens/Legal";
import { Me } from "./screens/Me";
import { ResetPassword } from "./screens/ResetPassword";
import { TermsUpdate } from "./screens/TermsUpdate";
import { consumeResetIntent } from "./resetIntent";
import { pendingInvite } from "./state";

export { pendingInvite, extractInviteCode } from "./state";

export const accounts: Module = {
  id: "accounts",
  register(shell) {
    shell.addFlag("accounts", true);
    shell.setAuthFlow(AuthFlow);
    shell.setTermsGate(TermsUpdate);
    shell.addTab({ id: "Me", title: "Me", icon: "person-circle-outline", order: 40, component: Me });
    shell.addRoute({ name: "EditProfile", component: EditProfile, title: "Edit profile" });
    shell.addRoute({ name: "CarPicker", component: CarPicker, title: "Your car" });
    shell.addRoute({ name: "ChangePassword", component: ChangePassword, title: "Change password" });
    shell.addRoute({ name: "Devices", component: Devices, title: "Devices" });
    shell.addRoute({ name: "Legal", component: Legal, title: "Safety terms" });
    shell.addRoute({ name: "DeleteAccount", component: DeleteAccount, title: "Delete account" });
    shell.addRoute({ name: "ResetPassword", component: ResetPassword, title: "New password", presentation: "modal" });

    shell.addLinkHandler({
      kind: "invite",
      handle(link: { code: string }) {
        if (shell.session.get().status === "signedIn") {
          Alert.alert("You already have an account", "Sign out first to join with a different invite.");
          return;
        }
        pendingInvite.set(link.code);
      },
    });
    shell.addLinkHandler({
      kind: "reset",
      async handle(link: { accessToken: string; refreshToken: string }) {
        if (!(await consumeResetIntent())) {
          Alert.alert("Reset link not requested here", "Request a reset from the sign in screen on this phone, then open the link from that email.");
          return;
        }
        try {
          await shell.backend.auth.startRecovery(link.accessToken, link.refreshToken);
          shell.navigate("ResetPassword");
        } catch {
          Alert.alert("Reset link expired", "Request a new reset link from the sign in screen.");
        }
      },
    });
    shell.addLinkHandler({
      kind: "confirmed",
      handle() {
        if (shell.session.get().status !== "signedIn") Alert.alert("Email confirmed", "You can sign in now.");
      },
    });
  },
};
