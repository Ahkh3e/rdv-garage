import "react-native-gesture-handler/jestSetup";

jest.mock("react-native-maps", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MapView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ animateCamera: jest.fn() }));
    return React.createElement(View, { testID: "map-view" }, props.children);
  });
  const Marker = (props: any) => React.createElement(View, { testID: `marker-${props.identifier}` }, props.children);
  return { __esModule: true, default: MapView, Marker, PROVIDER_GOOGLE: "google" };
});

jest.mock("expo-location", () => ({
  Accuracy: { High: 4, BestForNavigation: 6 },
  ActivityType: { AutomotiveNavigation: 2 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
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
