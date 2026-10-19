/** Shared state for the expo-camera mock in jest.setup.ts. */
export const mockCamera = {
  takePictureAsync: jest.fn(),
  recordAsync: jest.fn(),
  stopRecording: jest.fn(),
  cameraPermission: { granted: true, canAskAgain: true } as {
    granted: boolean;
    canAskAgain: boolean;
  },
  micPermission: { granted: true, canAskAgain: true } as { granted: boolean; canAskAgain: boolean },
  requestCamera: jest.fn(),
  requestMic: jest.fn(),
};

export function resetCameraMock() {
  mockCamera.takePictureAsync.mockReset();
  mockCamera.recordAsync.mockReset();
  mockCamera.stopRecording.mockReset();
  mockCamera.requestCamera.mockReset();
  mockCamera.requestMic.mockReset();
  mockCamera.cameraPermission = { granted: true, canAskAgain: true };
  mockCamera.micPermission = { granted: true, canAskAgain: true };
}
