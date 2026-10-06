import type { ComponentType } from "react";
import type { Events, Unsubscribe } from "./events";
import type { Store } from "./store";

export type CrewId = string;

// ---- Session ----------------------------------------------------------------
export interface Profile {
  id: string;
  handle: string;
  avatarPath: string | null;
}

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut"; notice?: "suspended" | "deleted" }
  | { status: "signedIn"; userId: string; profile: Profile };

export interface DeviceSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  isCurrent: boolean;
}

export interface AuthApi {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  // Opens the recovery session carried by a reset link.
  startRecovery(accessToken: string, refreshToken: string): Promise<void>;
  completePasswordReset(newPassword: string): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  listSessions(): Promise<DeviceSession[]>;
  revokeSession(id: string | "others"): Promise<void>;
}

// ---- Backend ----------------------------------------------------------------
export interface ChannelLike {
  on(event: string, fn: (payload: any) => void): void;
  subscribe(onStatus?: (status: "SUBSCRIBED" | "ERROR" | "CLOSED" | "TIMED_OUT") => void): void;
  send(event: string, payload: Record<string, unknown>): Promise<void>;
  track(state: Record<string, unknown>): Promise<void>;
  untrack(): Promise<void>;
  unsubscribe(): Promise<void>;
}

export interface Backend {
  auth: AuthApi;
  rpc<T = unknown>(schema: string, name: string, args?: Record<string, unknown>): Promise<T>;
  invokePublic<T = unknown>(name: string, body?: Record<string, unknown>): Promise<T>;
  invoke<T = unknown>(name: string, body?: Record<string, unknown>): Promise<T>;
  channel(name: string): ChannelLike;
  avatarUrl(path: string): Promise<string | null>;
  uploadAvatar(userId: string, data: ArrayBuffer, contentType: string): Promise<string>;
  userId(): string | null;
  onAuthChange(fn: (userId: string | null) => void): Unsubscribe;
}

// ---- Shared state contracts ---------------------------------------------------
export interface CrewMember {
  userId: string;
  handle: string;
  avatarPath: string | null;
  role: "owner" | "member";
  live: boolean;
}

export interface CrewSummary {
  id: CrewId;
  name: string;
  description: string | null;
  avatarPath: string | null;
  ownerId: string;
  role: "owner" | "member";
  linkCode: string | null;
  selected: boolean;
  members: CrewMember[];
  styleIndex: number;
}

export interface CrewContextState {
  loaded: boolean;
  crews: CrewSummary[];
  selected: CrewId[];
}

export interface CrewContext {
  store: Store<CrewContextState>;
  setCrews(crews: Omit<CrewSummary, "styleIndex">[]): void;
  reset(): void;
  select(ids: CrewId[]): void;
}

export interface MemberPosition {
  userId: string;
  crewIds: CrewId[];
  lat: number;
  lng: number;
  heading: number | null;
  ts: number;
}

export interface LocationStream {
  store: Store<Record<string, MemberPosition>>;
  publish(position: MemberPosition): void;
  remove(userId: string): void;
  clear(): void;
}

export interface LiveState {
  live: boolean;
  sessionId: string | null;
  crewIds: CrewId[];
}

// ---- Shell and modules --------------------------------------------------------
export interface Tab {
  id: string;
  title: string;
  icon: string;
  order: number;
  component: ComponentType<any>;
}

export interface Route {
  name: string;
  component: ComponentType<any>;
  title?: string;
  presentation?: "card" | "modal";
}

export interface MenuItem {
  id: string;
  title: string;
  icon: string;
  route: string;
  order: number;
}

export interface LinkHandler {
  kind: "invite" | "crew" | "reset" | "confirmed";
  handle(link: any): void;
}

export interface Shell {
  config: import("./config").AppConfig;
  backend: Backend;
  events: Events;
  session: Store<SessionState>;
  crewContext: CrewContext;
  locationStream: LocationStream;
  live: Store<LiveState>;
  addTab(tab: Tab): void;
  addRoute(route: Route): void;
  addFlag(name: string, defaultValue: boolean): void;
  isEnabled(name: string): boolean;
  addSlot(slot: string, component: ComponentType, order?: number): void;
  addMenuItem(item: MenuItem): void;
  addLinkHandler(handler: LinkHandler): void;
  setAuthFlow(component: ComponentType): void;
  navigate(route: string, params?: Record<string, unknown>): void;
}

export interface Module {
  id: string;
  register(shell: Shell): void;
}
