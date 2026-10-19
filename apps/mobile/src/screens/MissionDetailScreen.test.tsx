import { fireEvent, render, screen } from "@testing-library/react-native";

import { ApiError } from "../lib/api";
import { detail, fixAt, HERE } from "../test/fixtures";
import { MissionDetailScreen } from "./MissionDetailScreen";

async function setup(d = detail(), getMission = jest.fn().mockResolvedValue(d)) {
  const onStartCapture = jest.fn();
  const onVerify = jest.fn();
  await render(
    <MissionDetailScreen
      api={{ getMission }}
      missionId="m1"
      fix={fixAt(HERE.lat + 0.003, HERE.lng)}
      now={new Date("2026-10-19T10:00:00Z")}
      onStartCapture={onStartCapture}
      onVerify={onVerify}
    />,
  );
  return { onStartCapture, onVerify, getMission };
}

describe("MissionDetailScreen", () => {
  it("shows instructions, reward, radius, deadline and an example of the output", async () => {
    await setup(
      detail({
        outputSchema: {
          type: "object",
          properties: { is_open: { type: "boolean" }, queue_length: { type: "integer" } },
        },
      }),
    );
    expect(await screen.findByText("Photograph the storefront.")).toBeTruthy();
    expect(screen.getByText("2.00 USDG")).toBeTruthy();
    expect(screen.getByText("100 m radius")).toBeTruthy();
    expect(screen.getByText("24 h 0 min left")).toBeTruthy();
    expect(screen.getByText("334 m from the center")).toBeTruthy();
    expect(screen.getByTestId("circle").props.radius).toBe(100);
    expect(
      screen.getByText(JSON.stringify({ is_open: true, queue_length: 3 }, null, 2)),
    ).toBeTruthy();
  });

  it("opens the camera for an open, unlocked mission", async () => {
    const { onStartCapture } = await setup();
    await fireEvent.press(await screen.findByText("Open camera"));
    expect(onStartCapture).toHaveBeenCalled();
  });

  it("offers verification instead of the camera when locked", async () => {
    const { onVerify } = await setup(detail({ minTier: 2 }, { requiredTier: 2, locked: true }));
    expect(await screen.findByText("This mission needs Tier 2. You're Tier 1.")).toBeTruthy();
    expect(screen.queryByText("Open camera")).toBeNull();
    await fireEvent.press(screen.getByText("Unlock Tier 2"));
    expect(onVerify).toHaveBeenCalled();
  });

  it("shows the user's existing submission", async () => {
    await setup({
      ...detail(),
      mySubmission: { id: "s1", status: "processing", rejectionReasons: null },
    });
    expect(await screen.findByText("Your submission: Processing")).toBeTruthy();
    expect(screen.queryByText("Open camera")).toBeNull();
  });

  it("shows an error with retry", async () => {
    const getMission = jest
      .fn()
      .mockRejectedValueOnce(
        new ApiError(0, "network", "No connection. Check your internet and try again."),
      )
      .mockResolvedValue(detail());
    await setup(detail(), getMission);
    expect(await screen.findByText(/No connection/)).toBeTruthy();
    await fireEvent.press(screen.getByText("Try again"));
    expect(await screen.findByText("Open camera")).toBeTruthy();
  });
});
