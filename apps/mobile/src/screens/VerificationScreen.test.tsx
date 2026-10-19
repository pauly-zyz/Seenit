import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { ApiError, type PersonhoodStatus, type SessionInfo, type StartResponse } from "../lib/api";
import { VerificationScreen, type VerificationScreenProps } from "./VerificationScreen";

type VerificationApi = VerificationScreenProps["api"];

function statusFor(tier: number, missions = { t1: 4, t2: 6 }): PersonhoodStatus {
  return {
    wallet: "0xabc",
    tier,
    missionsOpenToYou: tier >= 2 ? missions.t2 : tier >= 1 ? missions.t1 : 0,
    attestations:
      tier >= 1
        ? [
            {
              provider: "human_passport",
              tier: 1,
              state: "active",
              verifiedAt: "2026-10-19T00:00:00Z",
              expiresAt: "2027-01-17T00:00:00Z",
              txHash: "0x1",
            },
          ]
        : [],
    tiers: [
      {
        tier: 1,
        name: "Verified human",
        howToVerify: "Reach the required Unique Humanity Score on Human Passport.",
        unlocks: "Missions paying up to 5.00 USDG per capture.",
        unlocked: tier >= 1,
        provider: "human_passport",
        activeMissions: missions.t1,
      },
      {
        tier: 2,
        name: "ID-verified human",
        howToVerify: "Scan your passport's NFC chip in the Self app.",
        unlocks: "All missions, including those paying more than 5.00 USDG per capture.",
        unlocked: tier >= 2,
        provider: "self",
        activeMissions: missions.t2,
      },
    ],
    providers: [
      { id: "human_passport", name: "Human Passport", tier: 1, flow: "instant" },
      { id: "self", name: "Self (passport NFC)", tier: 2, flow: "redirect" },
    ],
  };
}

function fakeApi(opts: {
  statuses: PersonhoodStatus[];
  start?: (p: string) => Promise<StartResponse>;
  sessions?: SessionInfo[];
}) {
  let i = 0;
  let s = 0;
  const api: VerificationApi & { started: string[] } = {
    started: [],
    getPersonhoodStatus: jest.fn(
      async () => opts.statuses[Math.min(i++, opts.statuses.length - 1)]!,
    ),
    startVerification: jest.fn(async (p) => {
      api.started.push(p);
      return opts.start!(p);
    }),
    getSession: jest.fn(async () => opts.sessions![Math.min(s++, opts.sessions!.length - 1)]!),
  };
  return api;
}

describe("VerificationScreen", () => {
  it("shows the current tier and what each tier unlocks", async () => {
    const api = fakeApi({ statuses: [statusFor(1)] });
    await render(<VerificationScreen api={api} />);
    expect(await screen.findByText("You're Tier 1")).toBeTruthy();
    expect(screen.getByText("4 active missions are open to you right now.")).toBeTruthy();
    expect(screen.getByText("Missions paying up to 5.00 USDG per capture.")).toBeTruthy();
    expect(
      screen.getByText("All missions, including those paying more than 5.00 USDG per capture."),
    ).toBeTruthy();
    expect(screen.getByText("Verified · valid until 2027-01-17")).toBeTruthy();
    expect(screen.getByText("Verify with Self")).toBeTruthy();
    expect(screen.queryByText("Check my Human Passport score")).toBeNull(); // already unlocked
    expect(screen.getByText(/passport data stays in the Self app/)).toBeTruthy();
  });

  it("asks unverified users to unlock Tier 1 before Tier 2", async () => {
    const api = fakeApi({ statuses: [statusFor(0)] });
    await render(<VerificationScreen api={api} />);
    expect(await screen.findByText("Not verified yet")).toBeTruthy();
    expect(screen.getByText("Check my Human Passport score")).toBeTruthy();
    expect(screen.getByText("Unlock Tier 1 first.")).toBeTruthy();
  });

  it("Tier 1: verifies instantly and refreshes", async () => {
    const api = fakeApi({
      statuses: [statusFor(0), statusFor(1)],
      start: async () => ({ status: "verified", sessionId: "s1", tier: 1 }),
    });
    await render(<VerificationScreen api={api} />);
    await fireEvent.press(await screen.findByText("Check my Human Passport score"));
    expect(await screen.findByText("Verified. You're now Tier 1.")).toBeTruthy();
    expect(await screen.findByText("You're Tier 1")).toBeTruthy();
    expect(api.started).toEqual(["human_passport"]);
  });

  it("Tier 1: explains a low score", async () => {
    const api = fakeApi({
      statuses: [statusFor(0)],
      start: async () => {
        throw new ApiError(422, "precheck_failed", "Not eligible yet", {
          reason: "score_too_low",
          score: 14,
          requiredScore: 20,
        });
      },
    });
    await render(<VerificationScreen api={api} />);
    await fireEvent.press(await screen.findByText("Check my Human Passport score"));
    expect(await screen.findByText(/Your Human Passport score is 14.0. You need 20/)).toBeTruthy();
  });

  it("Tier 2: opens the Self app, polls the session, then shows Tier 2", async () => {
    const openUrl = jest.fn(async () => true);
    const api = fakeApi({
      statuses: [statusFor(1), statusFor(2)],
      start: async () => ({
        status: "pending",
        sessionId: "s2",
        url: "https://redirect.self.xyz?selfApp=x",
        expiresAt: "",
      }),
      sessions: [
        { id: "s2", provider: "self", status: "pending", error: null, tier: 1 },
        { id: "s2", provider: "self", status: "verified", error: null, tier: 2 },
      ],
    });
    await render(<VerificationScreen api={api} openUrl={openUrl} pollIntervalMs={5} />);
    await fireEvent.press(await screen.findByText("Verify with Self"));
    expect(openUrl).toHaveBeenCalledWith("https://redirect.self.xyz?selfApp=x");
    expect(await screen.findByText("Waiting for the Self app…")).toBeTruthy();
    expect(await screen.findByText("Passport verified. Tier 2 is unlocked.")).toBeTruthy();
    expect(await screen.findByText("You're Tier 2")).toBeTruthy();
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it("Tier 2: explains when the identity is already used by another account", async () => {
    const api = fakeApi({
      statuses: [statusFor(1)],
      start: async () => ({
        status: "pending",
        sessionId: "s3",
        url: "https://redirect.self.xyz",
        expiresAt: "",
      }),
      sessions: [
        { id: "s3", provider: "self", status: "failed", error: "nullifier_in_use", tier: 1 },
      ],
    });
    await render(<VerificationScreen api={api} openUrl={async () => true} pollIntervalMs={5} />);
    await fireEvent.press(await screen.findByText("Verify with Self"));
    expect(await screen.findByText(/already linked to another Seenit account/)).toBeTruthy();
    expect(screen.getByText("Verify with Self")).toBeTruthy(); // button is back
  });

  it("shows a retry when the status can't load", async () => {
    let fail = true;
    const api: VerificationApi = {
      getPersonhoodStatus: jest.fn(async () => {
        if (fail)
          throw new ApiError(0, "network_error", "Can't reach Seenit. Check your connection.");
        return statusFor(0);
      }),
      startVerification: jest.fn(),
      getSession: jest.fn(),
    };
    await render(<VerificationScreen api={api} />);
    expect(await screen.findByText("Can't reach Seenit. Check your connection.")).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByText("Try again"));
    expect(await screen.findByText("Not verified yet")).toBeTruthy();
  });

  it("stops polling when unmounted", async () => {
    const api = fakeApi({
      statuses: [statusFor(1)],
      start: async () => ({
        status: "pending",
        sessionId: "s4",
        url: "https://redirect.self.xyz",
        expiresAt: "",
      }),
      sessions: [{ id: "s4", provider: "self", status: "pending", error: null, tier: 1 }],
    });
    const view = await render(
      <VerificationScreen api={api} openUrl={async () => true} pollIntervalMs={5} />,
    );
    await fireEvent.press(await screen.findByText("Verify with Self"));
    await waitFor(() => expect(api.getSession).toHaveBeenCalled());
    await view.unmount();
    const calls = (api.getSession as jest.Mock).mock.calls.length;
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect((api.getSession as jest.Mock).mock.calls.length).toBe(calls);
  });
});
