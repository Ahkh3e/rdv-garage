import "react-native-gesture-handler/jestSetup";

jest.mock("@maplibre/maplibre-react-native", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Map = (props: any) => React.createElement(View, { testID: props.testID ?? "map-view" }, props.children);
  const Camera = React.forwardRef((_props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ easeTo: jest.fn(), fitBounds: jest.fn(), zoomTo: jest.fn(), flyTo: jest.fn(), jumpTo: jest.fn(), setStop: jest.fn() }));
    return null;
  });
  const ViewAnnotation = (props: any) => React.createElement(View, { testID: `marker-${props.id}` }, props.children);
  const GeoJSONSource = (props: any) => React.createElement(View, { testID: "trail-source" }, props.children);
  const Layer = () => null;
  const Images = () => null;
  return { __esModule: true, Map, Camera, ViewAnnotation, GeoJSONSource, Layer, Images };
});

jest.mock("expo-location", () => ({
  Accuracy: { High: 4, BestForNavigation: 6 },
  ActivityType: { AutomotiveNavigation: 2 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 43.65, longitude: -79.38 } })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("expo-application", () => ({ getInstallReferrerAsync: jest.fn(async () => "") }));
jest.mock("expo-clipboard", () => ({ hasStringAsync: jest.fn(async () => false), getStringAsync: jest.fn(async () => "") }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })) }));
jest.mock("expo-image-manipulator", () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: "jpeg" } }));

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

jest.mock("expo-blur", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { BlurView: (props: any) => React.createElement(View, props) };
});

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
