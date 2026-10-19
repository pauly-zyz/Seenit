import { fireEvent, render, screen } from "@testing-library/react-native";

import { fixAt, HERE, nearby } from "../test/fixtures";
import { MissionsScreen } from "./MissionsScreen";

const missions = [
  nearby({
    id: "near",
    title: "Bakery open?",
    location: { lat: HERE.lat + 0.003, lng: HERE.lng },
    reward: "2000000",
  }),
  nearby({
    id: "far",
    title: "Station queue",
    location: { lat: HERE.lat + 0.08, lng: HERE.lng },
    reward: "4000000",
  }),
  nearby({
    id: "locked",
    title: "Bank branch photo",
    location: { lat: HERE.lat + 0.005, lng: HERE.lng },
    reward: "10000000",
    minTier: 2,
  }),
];

async function setup(tier = 1) {
  const api = { getNearby: jest.fn().mockResolvedValue({ missions }) };
  const onOpenMission = jest.fn();
  const onVerify = jest.fn();
  await render(
    <MissionsScreen
      api={api}
      tier={tier}
      fix={fixAt(HERE.lat, HERE.lng)}
      permission="granted"
      now={new Date("2026-10-19T10:00:00Z")}
      onOpenMission={onOpenMission}
      onVerify={onVerify}
    />,
  );
  return { api, onOpenMission, onVerify };
}

describe("MissionsScreen", () => {
  it("lists nearby missions with live distance and shows higher-tier missions locked", async () => {
    const { api } = await setup(1);
    expect(await screen.findByText("Bakery open?")).toBeTruthy();
    expect(api.getNearby).toHaveBeenCalledWith({ lat: -6.2, lng: 106.8, radiusKm: 26 });
    expect(screen.getByText("334 m")).toBeTruthy();
    expect(screen.getByLabelText("Bank branch photo, locked")).toBeTruthy();
    expect(screen.getByText("Tier 2 needed")).toBeTruthy();
    expect(screen.getByText(/1 locked mission needs a higher verification tier/)).toBeTruthy();
    // Default 5 km filter hides the 8.9 km mission.
    expect(screen.queryByText("Station queue")).toBeNull();
  });

  it("filters by distance and minimum reward", async () => {
    await setup(2);
    await screen.findByText("Bakery open?");
    await fireEvent.press(screen.getByText("10 km"));
    expect(screen.getByText("Station queue")).toBeTruthy();
    await fireEvent.press(screen.getByText("3+ USDG"));
    expect(screen.queryByText("Bakery open?")).toBeNull();
    expect(screen.getByText("Station queue")).toBeTruthy();
    expect(screen.getByText("Bank branch photo")).toBeTruthy();
    await fireEvent.press(screen.getByText("1 km"));
    expect(screen.queryByText("Station queue")).toBeNull();
  });

  it("opens a mission and routes locked banner to verification", async () => {
    const { onOpenMission, onVerify } = await setup(1);
    await fireEvent.press(await screen.findByText("Bakery open?"));
    expect(onOpenMission).toHaveBeenCalledWith("near");
    await fireEvent.press(screen.getByText(/Tap to verify/));
    expect(onVerify).toHaveBeenCalled();
  });

  it("shows markers on the map view", async () => {
    await setup(1);
    await screen.findByText("Bakery open?");
    await fireEvent.press(screen.getByText("Map"));
    expect(screen.getByTestId("marker-near")).toBeTruthy();
    expect(screen.getByTestId("marker-locked").props.description).toMatch(/locked/);
  });

  it("asks for location when permission is denied", async () => {
    const api = { getNearby: jest.fn() };
    await render(
      <MissionsScreen
        api={api}
        tier={1}
        fix={null}
        permission="denied"
        onOpenMission={jest.fn()}
        onVerify={jest.fn()}
      />,
    );
    expect(await screen.findByText(/Allow location access/)).toBeTruthy();
    expect(api.getNearby).not.toHaveBeenCalled();
  });
});
