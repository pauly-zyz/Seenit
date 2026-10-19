import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { mockCamera, resetCameraMock } from "../test/camera-mock";
import { detail, fixAt, HERE, NOW } from "../test/fixtures";
import { CaptureScreen, type CaptureDeps } from "./CaptureScreen";

const SHA = "ab".repeat(32);

async function setup(
  opts: {
    fix?: ReturnType<typeof fixAt> | null;
    video?: boolean;
    permission?: "granted" | "denied";
  } = {},
) {
  const mission = detail(opts.video ? { mediaType: "video", maxVideoSeconds: 20 } : {}).mission;
  const onCaptured = jest.fn().mockResolvedValue(undefined);
  const deps: Partial<CaptureDeps> = {
    persistCapture: jest.fn().mockResolvedValue({ uri: "file:///doc/captures/c1.jpg", size: 1234 }),
    sha256File: jest.fn().mockResolvedValue(SHA),
    deviceInfo: () => ({
      platform: "android",
      appVersion: "1.0.0",
      model: "Pixel 9",
      osVersion: "16",
    }),
    newId: () => "c1",
  };
  const fix = opts.fix === undefined ? fixAt(HERE.lat, HERE.lng) : opts.fix;
  await render(
    <CaptureScreen
      mission={mission}
      fix={fix}
      permission={opts.permission ?? "granted"}
      now={NOW}
      onCaptured={onCaptured}
      onClose={jest.fn()}
      deps={deps}
    />,
  );
  return { onCaptured, deps, mission };
}

beforeEach(resetCameraMock);

describe("CaptureScreen", () => {
  it("has no gallery or library option", async () => {
    await setup();
    await screen.findByTestId("shutter");
    expect(screen.queryByText(/gallery|library|choose|upload from/i)).toBeNull();
    expect(screen.queryByLabelText(/gallery|library/i)).toBeNull();
  });

  it("takes a photo inside the radius, hashes it on device and queues it with GPS, time and device", async () => {
    mockCamera.takePictureAsync.mockResolvedValue({ uri: "file:///cache/raw.jpg" });
    const { onCaptured, deps } = await setup();
    const shutter = await screen.findByLabelText("Take photo");
    expect(shutter).toBeEnabled();
    expect(screen.getByText(/You're in the mission area/)).toBeTruthy();

    await fireEvent.press(shutter);
    await waitFor(() => expect(onCaptured).toHaveBeenCalledTimes(1));

    expect(deps.persistCapture).toHaveBeenCalledWith("file:///cache/raw.jpg", "c1", "jpg");
    expect(deps.sha256File).toHaveBeenCalledWith("file:///doc/captures/c1.jpg");
    const item = onCaptured.mock.calls[0][0];
    expect(item).toMatchObject({
      id: "c1",
      missionId: "m1",
      fileUri: "file:///doc/captures/c1.jpg",
      contentType: "image/jpeg",
      size: 1234,
      capture: {
        missionId: "m1",
        source: "in_app_camera",
        mediaType: "photo",
        mediaSha256: SHA,
        gps: {
          lat: HERE.lat,
          lng: HERE.lng,
          accuracyMeters: 8,
          isMocked: false,
          fixAt: new Date(NOW - 1000).toISOString(),
        },
        device: { platform: "android", appVersion: "1.0.0", model: "Pixel 9", osVersion: "16" },
      },
    });
    expect(Date.parse(item.capture.capturedAt)).not.toBeNaN();
  });

  it("disables recording outside the mission radius", async () => {
    await setup({ fix: fixAt(HERE.lat + 0.01, HERE.lng) }); // ~1.1 km away, radius 100 m
    const shutter = await screen.findByLabelText("Take photo");
    expect(shutter).toBeDisabled();
    expect(screen.getByText(/outside the mission area/)).toBeTruthy();
    await fireEvent.press(shutter);
    expect(mockCamera.takePictureAsync).not.toHaveBeenCalled();
  });

  it("refuses a mocked location", async () => {
    await setup({ fix: fixAt(HERE.lat, HERE.lng, { mocked: true }) });
    expect(await screen.findByLabelText("Take photo")).toBeDisabled();
    expect(screen.getByText(/location looks simulated/)).toBeTruthy();
  });

  it("waits for a precise, fresh fix", async () => {
    await setup({ fix: fixAt(HERE.lat, HERE.lng, { accuracyMeters: 120 }) });
    expect(await screen.findByLabelText("Take photo")).toBeDisabled();
    expect(screen.getByText(/not precise enough/)).toBeTruthy();
  });

  it("is disabled without location permission", async () => {
    await setup({ fix: null, permission: "denied" });
    expect(await screen.findByLabelText("Take photo")).toBeDisabled();
  });

  it("records video and stops it, attaching the duration", async () => {
    let finish: (v: { uri: string }) => void = () => undefined;
    mockCamera.recordAsync.mockImplementation(() => new Promise((r) => (finish = r)));
    const { onCaptured, deps } = await setup({ video: true });

    await fireEvent.press(await screen.findByLabelText("Start recording"));
    expect(mockCamera.recordAsync).toHaveBeenCalledWith({ maxDuration: 20 });
    await fireEvent.press(await screen.findByLabelText("Stop recording"));
    expect(mockCamera.stopRecording).toHaveBeenCalled();

    finish({ uri: "file:///cache/raw.mp4" });
    await waitFor(() => expect(onCaptured).toHaveBeenCalled());
    expect(deps.persistCapture).toHaveBeenCalledWith("file:///cache/raw.mp4", "c1", "mp4");
    const item = onCaptured.mock.calls[0][0];
    expect(item.contentType).toBe("video/mp4");
    expect(item.capture.mediaType).toBe("video");
    expect(item.capture.videoDurationSeconds).toBeGreaterThan(0);
  });

  it("asks for camera permission before showing the camera", async () => {
    mockCamera.cameraPermission = { granted: false, canAskAgain: true };
    await setup();
    expect(await screen.findByText("Camera access needed")).toBeTruthy();
    expect(screen.queryByTestId("camera")).toBeNull();
    await fireEvent.press(screen.getByText("Allow access"));
    expect(mockCamera.requestCamera).toHaveBeenCalled();
  });

  it("shows an error when saving fails and lets the user try again", async () => {
    mockCamera.takePictureAsync.mockResolvedValue({ uri: "file:///cache/raw.jpg" });
    const { deps, onCaptured } = await setup();
    (deps.sha256File as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    await fireEvent.press(await screen.findByLabelText("Take photo"));
    expect(await screen.findByText(/Couldn't save the capture/)).toBeTruthy();
    expect(onCaptured).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Take photo")).toBeEnabled();
  });
});
