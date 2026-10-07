import { createContext, useContext, useEffect, useMemo, useState, type ComponentType } from "react";
import { Platform, StatusBar, StyleSheet, View } from "react-native";
import * as Linking from "expo-linking";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { BottomTabBarHeightContext, createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createNavigationContainerRef, DarkTheme, NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { AppConfig } from "./config";
import type {
  Backend, CrewContext, Handoff, CrewContextState, CrewSummary, LinkHandler, LiveState, LocationStream, MemberPosition,
  MenuItem, Route, SessionState, Shell, Tab,
} from "./contracts";
import { AppError } from "./errors";
import { createEvents } from "./events";
import { createPinRegistry } from "./pins";
import { parseLink } from "./links";
import { createStore, useStore, type Store } from "./store";
import { DEFAULT_CAR_ICON } from "./carIcons";
import { colors, fonts } from "./theme";
import { Spinner } from "./ui/Bits";
import { Glass, GlassButton } from "./ui/Glass";
import { Text } from "./ui/Text";

export interface ShellRuntime extends Shell {
  tabs: Tab[];
  routes: Route[];
  menu: MenuItem[];
  slots: Map<string, { component: ComponentType; order: number }[]>;
  authFlow: ComponentType | null;
  navRef: ReturnType<typeof createNavigationContainerRef>;
  flushNavigation(): void;
  setStackReady(ready: boolean): void;
  dispatchLink(url: string): void;
  start(): () => void;
}

function createCrewContext(events: ReturnType<typeof createEvents>): CrewContext {
  const store = createStore<CrewContextState>({ loaded: false, crews: [], selected: [] });
  return {
    store,
    setCrews(crews) {
      const withStyle: CrewSummary[] = crews.map((crew, index) => ({ ...crew, styleIndex: index }));
      store.set({ loaded: true, crews: withStyle, selected: withStyle.filter((c) => c.selected).map((c) => c.id) });
    },
    reset() {
      store.set({ loaded: false, crews: [], selected: [] });
    },
    select(ids) {
      store.set((prev) => ({
        ...prev,
        selected: ids,
        crews: prev.crews.map((c) => ({ ...c, selected: ids.includes(c.id) })),
      }));
      events.emit({ type: "crew.selected", crewIds: ids });
    },
  };
}

function createLocationStream(): LocationStream {
  const store = createStore<Record<string, MemberPosition>>({});
  return {
    store,
    publish: (p) => store.set((prev) => ({ ...prev, [p.userId]: p })),
    remove: (userId) =>
      store.set((prev) => {
        if (!(userId in prev)) return prev;
        const { [userId]: _removed, ...rest } = prev;
        return rest;
      }),
    clear: () => store.set({}),
  };
}

export function createShell(config: AppConfig, rawBackend: Backend): ShellRuntime {
  const events = createEvents();
  const session = createStore<SessionState>({ status: "loading" });
  const live = createStore<LiveState>({ live: false, sessionId: null, crewIds: [] });
  const flags = new Map<string, boolean>();
  const linkHandlers: LinkHandler[] = [];
  const pending: { route: string; params?: Record<string, unknown> }[] = [];
  const navRef = createNavigationContainerRef();
  // Navigation is only delivered once the signed-in screens are mounted; before that the request waits.
  let stackReady = false;
  let handoff: Handoff | null = null;

  // Any call that comes back "suspended" signs the user out everywhere on this device.
  let suspending = false;
  const onSuspended = () => {
    if (suspending) return;
    suspending = true;
    events.emit({ type: "account.suspended" });
    rawBackend.auth.signOut().finally(() => {
      session.set({ status: "signedOut", notice: "suspended" });
      suspending = false;
    });
  };
  const guard = async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AppError && error.code === "suspended") onSuspended();
      throw error;
    }
  };
  const backend: Backend = {
    ...rawBackend,
    rpc: (schema, name, args) => guard(() => rawBackend.rpc(schema, name, args)),
    invoke: (name, body) => guard(() => rawBackend.invoke(name, body)),
  };

  const shell: ShellRuntime = {
    config,
    backend,
    events,
    session,
    live,
    crewContext: createCrewContext(events),
    locationStream: createLocationStream(),
    pins: createPinRegistry(),
    handoff: {
      openDirections: (target) => (handoff ? handoff.openDirections(target) : Promise.reject(new AppError("handoff_unavailable"))),
    },
    setHandoff(next) {
      handoff = next;
    },
    tabs: [],
    routes: [],
    menu: [],
    slots: new Map(),
    authFlow: null,
    navRef,
    flushNavigation: () => flush(),
    setStackReady(ready) {
      stackReady = ready;
      if (ready) flush();
    },
    addTab: (tab) => void shell.tabs.push(tab),
    addRoute: (route) => void shell.routes.push(route),
    addFlag: (name, def) => void flags.set(name, config.flags[name] ?? def),
    isEnabled: (name) => flags.get(name) ?? config.flags[name] ?? true,
    addSlot(slot, component, order = 0) {
      const list = shell.slots.get(slot) ?? [];
      list.push({ component, order });
      list.sort((a, b) => a.order - b.order);
      shell.slots.set(slot, list);
    },
    addMenuItem: (item) => void shell.menu.push(item),
    addLinkHandler: (handler) => void linkHandlers.push(handler),
    setAuthFlow(component) {
      shell.authFlow = component;
    },
    navigate(route, params) {
      pending.push({ route, params });
      flush();
    },
    dispatchLink(url) {
      const link = parseLink(url);
      if (!link) return;
      for (const handler of linkHandlers) if (handler.kind === link.kind) handler.handle(link);
    },
    start() {
      const stops: (() => void)[] = [];
      stops.push(
        backend.onAuthChange(async (userId) => {
          if (!userId) {
            const prev = session.get();
            session.set({ status: "signedOut", notice: prev.status === "signedOut" ? prev.notice : undefined });
            shell.locationStream.clear();
            shell.crewContext.reset();
            shell.live.set({ live: false, sessionId: null, crewIds: [] });
            return;
          }
          await loadProfile(userId);
        }),
      );
      Linking.getInitialURL().then((url) => url && shell.dispatchLink(url));
      const sub = Linking.addEventListener("url", ({ url }) => shell.dispatchLink(url));
      stops.push(() => sub.remove());
      return () => stops.forEach((stop) => stop());
    },
  };

  async function loadProfile(userId: string): Promise<void> {
    try {
      const rows = await backend.rpc<{ id: string; handle: string; avatar_path: string | null; car_icon?: string; status: string }[]>("accounts", "my_profile");
      const row = rows[0];
      if (!row || row.status === "deleted") {
        await backend.auth.signOut();
        session.set({ status: "signedOut", notice: "deleted" });
      } else if (row.status === "suspended") {
        await backend.auth.signOut();
        session.set({ status: "signedOut", notice: "suspended" });
      } else {
        session.set({ status: "signedIn", userId: row.id, profile: { id: row.id, handle: row.handle, avatarPath: row.avatar_path, carIcon: row.car_icon ?? DEFAULT_CAR_ICON } });
      }
    } catch (error) {
      if (error instanceof AppError && (error.code === "network" || error.code === "unknown_error")) {
        // A valid stored session must not look like a sign out just because the phone is offline at launch.
        // Show a waiting screen and keep trying while this person is still the signed-in user.
        if (session.get().status !== "signedIn") session.set({ status: "offline" });
        setTimeout(() => {
          if (backend.userId() === userId && session.get().status === "offline") void loadProfile(userId);
        }, 5000);
        return;
      }
      await backend.auth.signOut();
      session.set({ status: "signedOut" });
    }
  }

  function flush() {
    if (!stackReady || !navRef.isReady() || session.get().status !== "signedIn") return;
    while (pending.length) {
      const next = pending.shift()!;
      (navRef as any).navigate(next.route, next.params);
    }
  }

  return shell;
}

// ---- React bindings ----------------------------------------------------------------
const ShellContext = createContext<ShellRuntime | null>(null);

export function useShell(): ShellRuntime {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell must be used inside <ShellApp>");
  return shell;
}

export const useSession = () => useStore(useShell().session);
export const useCrewState = () => useStore(useShell().crewContext.store);
export const useLiveState = () => useStore(useShell().live);
export const usePositions = () => useStore(useShell().locationStream.store);

export function useSignedInProfile() {
  const state = useSession();
  if (state.status !== "signedIn") throw new Error("not signed in");
  return state;
}

export function Slot({ name }: { name: string }) {
  const shell = useShell();
  const items = shell.slots.get(name) ?? [];
  return (
    <>
      {items.map(({ component: C }, i) => (
        <C key={`${name}-${i}`} />
      ))}
    </>
  );
}

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.background, card: colors.background, border: colors.hairline, primary: colors.accent, text: colors.text },
};

const TAB_ICONS: Record<string, string> = { Map: "map", Crews: "users", Board: "award", Me: "user" };

const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabsScreen() {
  const shell = useShell();
  const tabs = useMemo(() => [...shell.tabs].sort((a, b) => a.order - b.order), [shell]);
  return (
    <Tabs.Navigator
      initialRouteName={tabs.find((t) => t.id === "Map")?.id ?? tabs[0]?.id}
      screenListeners={{ tabPress: () => void Haptics.selectionAsync().catch(() => undefined) }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.subtle,
        tabBarStyle: { position: "absolute", backgroundColor: "transparent", borderTopWidth: 0, elevation: 0 },
        tabBarBackground: () => <Glass kind="bar" style={{ flex: 1, borderWidth: 0, borderTopWidth: StyleSheet.hairlineWidth }} />,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 10.5, letterSpacing: 0.2 },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.id}
          name={tab.id}
          component={tab.component}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, focused }) => (
              <View style={{ alignItems: "center" }}>
                <View style={{ position: "absolute", top: -9, width: 16, height: 2, borderRadius: 1, backgroundColor: focused ? colors.accentBright : "transparent" }} />
                <Feather name={(TAB_ICONS[tab.id] ?? "circle") as any} size={22} color={color} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs.Navigator>
  );
}

function SignedInStack() {
  const shell = useShell();
  // Queued navigations (a reset link opened at launch) are delivered once the signed-in screens exist.
  useEffect(() => {
    shell.setStackReady(true);
    return () => shell.setStackReady(false);
  }, [shell]);
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
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 17 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
      })}
    >
      <Stack.Screen name="Tabs" component={TabsScreen} options={{ headerShown: false }} />
      {shell.routes.map((route) => (
        <Stack.Screen
          key={route.name}
          name={route.name}
          component={route.component}
          options={{ title: route.title ?? "", presentation: route.presentation === "modal" ? "modal" : "card" }}
        />
      ))}
    </Stack.Navigator>
  );
}

export function ShellApp({ shell }: { shell: ShellRuntime }) {
  const state = useStore(shell.session);
  const [ready, setReady] = useState(false);
  useEffect(() => shell.start(), [shell]);
  const AuthFlow = shell.authFlow;

  let body;
  if (state.status === "loading") body = <Spinner />;
  else if (state.status === "offline") body = <Offline />;
  else if (state.status === "signedOut") body = AuthFlow ? <AuthFlow /> : <Spinner />;
  else body = <SignedInStack />;

  return (
    <ShellContext.Provider value={shell}>
      <SafeAreaProvider>
        <View style={styles.root}>
          <StatusBar barStyle="light-content" backgroundColor={Platform.OS === "android" ? colors.background : undefined} />
          <NavigationContainer ref={shell.navRef} theme={navTheme} onReady={() => { setReady(true); shell.flushNavigation(); }}>
            {body}
          </NavigationContainer>
        </View>
      </SafeAreaProvider>
    </ShellContext.Provider>
  );
}

function Offline() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32, backgroundColor: colors.background }}>
      <Spinner />
      <Text variant="title" style={{ textAlign: "center" }}>Can't reach RDV Garage</Text>
      <Text muted style={{ textAlign: "center" }}>You're still signed in. We'll keep trying.</Text>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.background } });

export type { Store };
