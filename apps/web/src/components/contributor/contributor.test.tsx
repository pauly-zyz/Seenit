import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ContributorApi, ContributorApiError } from "@/lib/contributor/api";
import type { MissionDetail, NearbyMission, PersonhoodStatus } from "@/lib/contributor/types";

import type { CameraDeps } from "./camera";
import { ContributorGate } from "./gate";
import { MissionView } from "./mission-view";
import { MissionsView } from "./missions-view";
import { ContributorProviders, retry } from "./providers";
import { isActive } from "./shell";
import type { LiveLocation } from "./use-location";
import { VerifyView } from "./verify-view";

vi.mock("@/components/dashboard/maps", () => ({
  NearbyMap: () => <div data-testid="map" />,
  SubmissionsMap: () => <div data-testid="map" />,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/app",
  useParams: () => ({}),
}));

const SPOT = { lat: -6.2, lng: 106.8 };
const meta = { chainId: 46630, token: { symbol: "USDG", decimals: 6 } };

const me = (tier = 1): PersonhoodStatus => ({
  wallet: "0x1111111111111111111111111111111111111111",
  tier,
  missionsOpenToYou: 2,
  attestations: [],
  tiers: [
    {
      tier: 1,
      name: "Verified human",
      howToVerify: "Human Passport score",
      unlocks: "Low-value missions",
      unlocked: tier >= 1,
      provider: tier >= 1 ? "human_passport" : null,
      activeMissions: 3,
    },
    {
      tier: 2,
      name: "Verified ID",
      howToVerify: "Passport NFC with Self",
      unlocks: "All missions",
      unlocked: tier >= 2,
      provider: null,
      activeMissions: 1,
    },
  ],
  providers: [
    { id: "human_passport", name: "Human Passport", tier: 1, flow: "instant" },
    { id: "self", name: "Self", tier: 2, flow: "redirect" },
  ],
});

const location = (over: Partial<LiveLocation> = {}): LiveLocation => ({
  permission: "granted",
  fix: { ...SPOT, accuracyMeters: 8, timestamp: Date.now() },
  error: null,
  start: () => {},
  ...over,
});

const nearby = (over: Partial<NearbyMission>): NearbyMission => ({
  id: "m1",
  title: "Is Luna Bakery open?",
  instructions: "Photograph the entrance.",
  mediaType: "photo",
  maxVideoSeconds: null,
  location: SPOT,
  radiusMeters: 100,
  reward: "2000000",
  maxCaptures: 3,
  minTier: 1,
  deadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
  status: "active",
  outputSchema: { type: "object", properties: { is_open: { type: "boolean" } } },
  onchainId: "1",
  distanceMeters: 300,
  withinMissionRadius: false,
  slotsLeft: 3,
  ...over,
});

const detail = (over: Partial<MissionDetail["mission"]> = {}): MissionDetail => ({
  mission: { ...nearby({}), slotsLeft: 3, open: true, ...over },
  access: { yourTier: 1, requiredTier: 1, locked: false },
  mySubmission: null,
});

function renderWith(ui: React.ReactNode, api: Partial<ContributorApi>) {
  return render(
    <ContributorProviders api={{ meta: async () => meta, ...api } as unknown as ContributorApi}>
      {ui}
    </ContributorProviders>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }),
  );
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("sign-in gate", () => {
  it("shows the wallet sign-in when signed out", async () => {
    renderWith(<ContributorGate>{() => <p>inside</p>}</ContributorGate>, {
      personhood: async () => {
        throw new ContributorApiError(401, "unauthorized", "Sign in");
      },
    });
    expect(await screen.findByText("Earn by capturing the world")).toBeTruthy();
    expect(screen.queryByText("inside")).toBeNull();
  });

  it("explains an unconfigured server instead of a bare HTTP error", async () => {
    renderWith(<ContributorGate>{() => <p>inside</p>}</ContributorGate>, {
      personhood: async () => {
        throw new ContributorApiError(503, "not_configured", "x");
      },
    });
    expect(await screen.findByText(/getting ready/)).toBeTruthy();
    expect(retry(0, new ContributorApiError(503, "not_configured", "x"))).toBe(false);
    expect(retry(0, new ContributorApiError(502, "chain_error", "x"))).toBe(true);
    expect(retry(0, new ContributorApiError(404, "not_found", "x"))).toBe(false);
    expect(retry(1, new ContributorApiError(0, "network_error", "x"))).toBe(false);
  });

  it("renders the app for a signed-in contributor; Missions stays active on a mission page", async () => {
    renderWith(<ContributorGate>{(m) => <p>tier {m.tier}</p>}</ContributorGate>, {
      personhood: async () => me(2),
    });
    expect(await screen.findByText("tier 2")).toBeTruthy();
    expect(isActive("/app", "/app/missions/abc")).toBe(true);
    expect(isActive("/app/verify", "/app")).toBe(false);
  });
});

describe("missions near you", () => {
  it("asks for location first", () => {
    renderWith(
      <MissionsView me={me()} location={location({ fix: null, permission: "undetermined" })} />,
      {},
    );
    expect(screen.getByText("Find missions near you")).toBeTruthy();
  });

  it("lists unlocked missions first with reward, distance and lock", async () => {
    const api = {
      nearby: vi.fn(async () => ({
        missions: [
          nearby({ id: "far", title: "Billboard check", distanceMeters: 2500, minTier: 1 }),
          nearby({
            id: "locked",
            title: "Construction site",
            distanceMeters: 100,
            minTier: 2,
            reward: "9000000",
          }),
          nearby({ id: "near", title: "Is Luna Bakery open?", distanceMeters: 300 }),
        ],
      })),
    };
    renderWith(<MissionsView me={me(1)} location={location()} />, api);
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Is Luna Bakery open?"),
      expect.stringContaining("Billboard check"),
      expect.stringContaining("Needs Tier 2"),
    ]);
    expect(items[0]!.textContent).toContain("2.00 USDG");
    expect(items[0]!.textContent).toContain("300 m away");
    expect(api.nearby).toHaveBeenCalledWith({ lat: -6.2, lng: 106.8, radiusKm: 25 });
  });

  it("nudges unverified contributors to verify", async () => {
    renderWith(<MissionsView me={me(0)} location={location()} />, {
      nearby: async () => ({ missions: [] }),
    });
    expect(await screen.findByText(/No open missions/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Verify now" }).getAttribute("href")).toBe(
      "/app/verify",
    );
  });
});

/** A MediaRecorder stand-in: stop() emits one chunk and fires onstop. */
function fakeCamera(): CameraDeps & { stopped: () => boolean } {
  let tracksStopped = false;
  const stream = {
    getTracks: () => [{ stop: () => (tracksStopped = true) }],
  } as unknown as MediaStream;
  return {
    getUserMedia: async () => stream,
    isTypeSupported: (t) => t === "video/webm",
    createRecorder: () => {
      const rec = {
        mimeType: "video/webm",
        ondataavailable: null as null | ((e: { data: Blob }) => void),
        onstop: null as null | (() => void),
        start: () => {},
        stop: () => {
          rec.ondataavailable?.({ data: new Blob(["fake-video"], { type: "video/webm" }) });
          rec.onstop?.();
        },
      };
      return rec as unknown as MediaRecorder;
    },
    stopped: () => tracksStopped,
  };
}

describe("mission capture", () => {
  it("records in the mission area, uploads with the signed URL and finalizes", async () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = put as unknown as typeof fetch;
    const api = {
      mission: vi.fn(async () => detail({ mediaType: "video", maxVideoSeconds: 20 })),
      uploadUrl: vi.fn(async () => ({
        submissionId: "s1",
        upload: {
          url: "https://r2.example/put",
          method: "PUT" as const,
          headers: { "content-type": "video/webm", "content-length": "10" },
          expiresAt: "",
        },
      })),
      finalize: vi.fn(async () => ({ submission: { id: "s1", status: "processing" as const } })),
    };
    const cam = fakeCamera();
    renderWith(<MissionView id="m1" me={me()} location={location()} cameraDeps={cam} />, api);

    fireEvent.click(await screen.findByRole("button", { name: "Open camera" }));
    const record = await screen.findByRole("button", { name: "Start recording" });
    await waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByLabelText(/gallery|upload a file/i)).toBeNull();
    await act(async () => fireEvent.click(record));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop recording" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit capture" })));

    expect(await screen.findByText(/Submitted!/)).toBeTruthy();
    expect(api.uploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "m1",
        mediaType: "video",
        contentType: "video/webm",
        contentLength: 10,
      }),
    );
    expect(put).toHaveBeenCalledWith("https://r2.example/put", {
      method: "PUT",
      headers: { "content-type": "video/webm" },
      body: expect.any(Blob),
    });
    const capture = (
      api.finalize.mock.calls[0] as unknown as [
        { capture: { device: { platform: string }; mediaSha256: string } },
      ]
    )[0].capture;
    expect(capture.device.platform).toBe("web");
    expect(capture.mediaSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(cam.stopped()).toBe(true); // camera released when it closed
  });

  it("keeps the shutter disabled outside the mission area", async () => {
    renderWith(
      <MissionView
        id="m1"
        me={me()}
        location={location({
          fix: { lat: -6.21, lng: 106.8, accuracyMeters: 8, timestamp: Date.now() },
        })}
        cameraDeps={fakeCamera()}
      />,
      { mission: async () => detail() },
    );
    expect(await screen.findByText(/outside the mission area/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open camera" }));
    expect(
      ((await screen.findByRole("button", { name: "Take photo" })) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("explains a locked mission instead of offering the camera", async () => {
    renderWith(<MissionView id="m1" me={me(1)} location={location()} />, {
      mission: async () => ({
        ...detail(),
        access: { yourTier: 1, requiredTier: 2, locked: true },
      }),
    });
    expect(await screen.findByText(/needs Tier 2/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open camera" })).toBeNull();
  });
});

describe("verification", () => {
  it("verifies with Human Passport in place", async () => {
    const api = {
      startVerification: vi.fn(async () => ({
        status: "verified" as const,
        sessionId: "v1",
        tier: 1,
      })),
      personhood: async () => me(1),
    };
    renderWith(<VerifyView me={me(0)} />, api);
    fireEvent.click(screen.getByRole("button", { name: "Verify with Human Passport" }));
    expect(await screen.findByText("Verified! You're now Tier 1.")).toBeTruthy();
    expect(api.startVerification).toHaveBeenCalledWith("human_passport");
  });

  it("explains a low Passport score", async () => {
    renderWith(<VerifyView me={me(0)} />, {
      startVerification: async () => {
        throw new ContributorApiError(422, "precheck_failed", "x", {
          reason: "score_too_low",
          score: 12.5,
          requiredScore: 20,
        });
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify with Human Passport" }));
    expect(await screen.findByText(/score is 12.5. You need 20/)).toBeTruthy();
  });

  it("shows a Self QR code and polls until the proof arrives", async () => {
    let polls = 0;
    const api = {
      startVerification: async () => ({
        status: "pending" as const,
        sessionId: "v2",
        url: "https://redirect.self.xyz/?selfApp=abc",
        expiresAt: "",
      }),
      verificationSession: vi.fn(async () => ({
        id: "v2",
        provider: "self" as const,
        status: (++polls < 2 ? "pending" : "verified") as "pending" | "verified",
        error: null,
        tier: 2,
      })),
      personhood: async () => me(2),
    };
    renderWith(<VerifyView me={me(1)} pollIntervalMs={10} />, api);
    fireEvent.click(screen.getByRole("button", { name: "Verify with Self" }));
    const qr = await screen.findByAltText("Self verification QR code");
    expect(qr.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByRole("link", { name: "Open Self app" }).getAttribute("href")).toBe(
      "https://redirect.self.xyz/?selfApp=abc",
    );
    expect(await screen.findByText("Verified! You're now Tier 2.")).toBeTruthy();
    expect(polls).toBe(2);
  });
});
