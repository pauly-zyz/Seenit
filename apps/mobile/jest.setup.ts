/* eslint-disable @typescript-eslint/no-require-imports */
// Native modules the screens import, replaced with light JS stand-ins.

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("react-native-maps", () => {
  const React = require("react");
  const { View } = require("react-native");
  const stub = (name: string) => {
    const C = (props: Record<string, unknown> & { children?: unknown; testID?: string }) =>
      React.createElement(View, { ...props, testID: props.testID ?? name }, props.children);
    C.displayName = name;
    return C;
  };
  return { __esModule: true, default: stub("map"), Marker: stub("marker"), Circle: stub("circle") };
});

jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");
  const { mockCamera } = require("./src/test/camera-mock");
  const CameraView = React.forwardRef(
    (props: { onCameraReady?: () => void; testID?: string; mode?: string }, ref: unknown) => {
      React.useImperativeHandle(ref, () => mockCamera);
      React.useEffect(() => props.onCameraReady?.(), []); // eslint-disable-line react-hooks/exhaustive-deps
      return React.createElement(View, { testID: props.testID, accessibilityHint: props.mode });
    },
  );
  CameraView.displayName = "CameraView";
  return {
    CameraView,
    useCameraPermissions: () => [mockCamera.cameraPermission, mockCamera.requestCamera],
    useMicrophonePermissions: () => [mockCamera.micPermission, mockCamera.requestMic],
  };
});

jest.mock("expo-file-system", () => ({
  File: jest.fn(),
  Directory: jest.fn(),
  Paths: { document: "file:///doc", cache: "file:///cache" },
}));
