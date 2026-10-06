import "react-native-gesture-handler";
import { useEffect, useMemo } from "react";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from "@expo-google-fonts/inter";
import { InterTight_600SemiBold, InterTight_700Bold } from "@expo-google-fonts/inter-tight";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { Spinner, ShellApp, createBackend, createShell } from "@rdv/core";
import { config } from "./src/config";
import { modules } from "./src/modules";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, InterTight_600SemiBold, InterTight_700Bold, JetBrainsMono_500Medium });

  const shell = useMemo(() => {
    const backend = createBackend(config, {
      getItemAsync: (key) => SecureStore.getItemAsync(key),
      setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
      deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
    });
    const next = createShell(config, backend);
    for (const module of modules) module.register(next);
    return next;
  }, []);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  if (!fontsLoaded) return <Spinner />;
  return <ShellApp shell={shell} />;
}
