import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardApi } from "@/lib/dashboard/api";
import type { Meta, MissionListItem, ReviewItem, Template } from "@/lib/dashboard/types";

import { ApiKeys } from "./api-keys";
import { FundMission } from "./fund-mission";
import { buildSpec, defaultDraft, MissionForm } from "./mission-form";
import { MissionsList } from "./missions-list";
import { SubmissionCard } from "./mission-review";
import { DashboardProviders } from "./providers";
import { isActive } from "./shell";

vi.mock("./maps", () => ({
  LocationPickerMap: () => <div data-testid="map" />,
  SubmissionsMap: () => <div data-testid="map" />,
}));

const meta: Meta = {
  chainId: 46630,
  escrow: "0x00000000000000000000000000000000000e5c20",
  token: { address: "0x0000000000000000000000000000000000007070", symbol: "USDG", decimals: 6 },
  tier1MaxReward: "5000000",
};

const templates: Template[] = [
  {
    id: "store_open",
    name: "Is the store open?",
    description: "Open right now?",
    mediaType: "photo",
    suggestedInstructions: "Photograph the entrance so the door and any notice are visible.",
    outputSchema: {
      type: "object",
      properties: { is_open: { type: "string", enum: ["open", "closed", "unclear"] } },
      required: ["is_open"],
    },
  },
  {
    id: "crowd_level",
    name: "Crowd level",
    description: "How busy?",
    mediaType: "video",
    suggestedInstructions: "Record 10 seconds of the queue.",
    outputSchema: { type: "object", properties: { crowd_level: { type: "string" } } },
  },
];

function renderWith(ui: React.ReactNode, api: Partial<DashboardApi> = {}) {
  return render(<DashboardProviders api={api as DashboardApi}>{ui}</DashboardProviders>);
}

afterEach(() => vi.restoreAllMocks());

describe("mission form", () => {
  it("validates and builds the API spec, including the automatic Tier 2", () => {
    const d = {
      ...defaultDraft(templates, new Date("2026-11-02T10:00:00")),
      title: "Is Luna Bakery open?",
    };
    const ok = buildSpec(d, templates, meta);
    expect(ok.spec).toMatchObject({
      rewardPerSubmission: "2000000",
      maxSubmissions: 3,
      outputSchema: templates[0]!.outputSchema,
      location: { lat: -6.175392, lng: 106.827153 },
    });
    expect(ok.total).toBe(6_000_000n);
    expect(ok.tier).toBe(1);
    expect(buildSpec({ ...d, reward: "10" }, templates, meta).tier).toBe(2);
    expect(buildSpec({ ...d, reward: "abc" }, templates, meta).errors.reward).toMatch(/USDG/);
    expect(buildSpec({ ...d, title: "" }, templates, meta).errors.title).toBeDefined();
    expect(buildSpec({ ...d, radiusMeters: 5 }, templates, meta).errors.radiusMeters).toBeDefined();
  });

  it("shows the escrow total and submits the spec", async () => {
    const onSubmit = vi.fn();
    renderWith(<MissionForm meta={meta} templates={templates} onSubmit={onSubmit} />);
    expect(screen.getByTestId("total").textContent).toBe("6.00 USDG");
    fireEvent.click(screen.getByRole("button", { name: "Create and fund" }));
    expect(onSubmit).not.toHaveBeenCalled(); // title missing
    expect(await screen.findByText("Fix the highlighted fields.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Is Luna Bakery open?" } });
    fireEvent.change(screen.getByLabelText("Reward per accepted capture (USDG)"), {
      target: { value: "2.5" },
    });
    fireEvent.change(screen.getByLabelText("Captures wanted"), { target: { value: "4" } });
    expect(screen.getByTestId("total").textContent).toBe("10.00 USDG");
    fireEvent.click(screen.getByRole("button", { name: "Create and fund" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Is Luna Bakery open?",
        rewardPerSubmission: "2500000",
        maxSubmissions: 4,
      }),
    );
  });

  it("switching template updates media type and suggested instructions", () => {
    renderWith(<MissionForm meta={meta} templates={templates} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Answer template"), {
      target: { value: "crowd_level" },
    });
    expect((screen.getByLabelText("Media") as HTMLSelectElement).value).toBe("video");
    expect(
      (screen.getByLabelText("Instructions for the contributor") as HTMLTextAreaElement).value,
    ).toBe("Record 10 seconds of the queue.");
    expect(screen.getByLabelText("Max video length (s)")).toBeTruthy();
  });
});

describe("FundMission", () => {
  const mission = {
    id: "m1",
    title: "Luna",
    reward: "2000000",
    maxCaptures: 3,
    minTier: 1,
    specHash: `0x${"ab".repeat(32)}`,
    deadline: "2026-11-03T10:00:00.000Z",
    status: "pending_funding",
  } as never;

  it("asks to connect a wallet first", () => {
    renderWith(
      <FundMission
        api={{ confirmMission: vi.fn() }}
        wallet={null}
        mission={mission}
        funding={{ total: "6000000", transactions: [] } as never}
        meta={meta}
        onLive={vi.fn()}
      />,
    );
    expect(screen.getByText("Connect your wallet to fund this mission.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Fund 6.00 USDG/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows a readable error when the transactions don't check out", async () => {
    const wallet = { account: "0x1" as Hex } as never;
    renderWith(
      <FundMission
        api={{ confirmMission: vi.fn() }}
        wallet={wallet}
        mission={mission}
        funding={{ total: "1", transactions: [] } as never}
        meta={meta}
        onLive={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Fund/ }));
    expect(await screen.findByText(/Expected exactly two funding transactions/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("API keys", () => {
  it("creates a key, shows it once, and revokes after confirmation", async () => {
    let keys = [
      {
        id: "k1",
        name: "old",
        prefix: "sk_abcdefg",
        createdAt: "2026-11-01T10:00:00Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    ];
    const api = {
      apiKeys: vi.fn(async () => ({ keys })),
      createApiKey: vi.fn(async (name: string) => {
        keys = [
          {
            id: "k2",
            name,
            prefix: "sk_newkey12",
            createdAt: "2026-11-02T10:00:00Z",
            lastUsedAt: null,
            revokedAt: null,
          },
          ...keys,
        ];
        return { id: "k2", name, prefix: "sk_newkey12", key: "sk_newkey12345secret" };
      }),
      revokeApiKey: vi.fn(async () => {
        keys = keys.map((k) =>
          k.id === "k1" ? { ...k, revokedAt: "2026-11-02T11:00:00Z" } : k,
        ) as never;
        return keys[1] as never;
      }),
    };
    renderWith(<ApiKeys />, api as never);
    expect(await screen.findByText("old")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "research agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect((await screen.findByTestId("new-key")).textContent).toBe("sk_newkey12345secret");
    expect(await screen.findByText("research agent")).toBeTruthy();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    const revokes = await screen.findAllByRole("button", { name: "Revoke" });
    fireEvent.click(revokes.at(-1)!);
    await waitFor(() => expect(api.revokeApiKey).toHaveBeenCalledWith("k1"));
    expect(await screen.findByText("Revoked")).toBeTruthy();
  });
});

describe("missions list", () => {
  it("shows escrow totals and refunds expired missions", async () => {
    const m = (over: Partial<MissionListItem>): MissionListItem =>
      ({
        id: "m1",
        title: "Luna",
        reward: "2000000",
        maxCaptures: 3,
        minTier: 1,
        mediaType: "photo",
        status: "active",
        deadline: "2026-11-01T10:00:00Z",
        submissions: { processing: 0, ready: 1, needsReview: 1, accepted: 1, rejected: 0 },
        escrow: {
          funded: "6000000",
          paidOut: "2000000",
          paidToContributors: "1900000",
          platformFees: "100000",
          inReview: "2000000",
          unused: "2000000",
          returned: "0",
          held: "4000000",
          expired: true,
          refundable: true,
        },
        ...over,
      }) as MissionListItem;
    const api = {
      missions: vi.fn(async () => ({
        token: { symbol: "USDG", decimals: 6 },
        missions: [
          m({}),
          m({
            id: "m2",
            title: "Draft",
            status: "pending_funding",
            submissions: { processing: 0, ready: 0, needsReview: 0, accepted: 0, rejected: 0 },
            escrow: { ...m({}).escrow, held: "0", paidOut: "0", refundable: false },
          }),
        ],
      })),
      refund: vi.fn(async () => ({ mission: {} as never, refunded: "2000000", txHash: "0xabc" })),
    };
    renderWith(<MissionsList />, api as never);
    expect(await screen.findByText("Luna")).toBeTruthy();
    expect(screen.getByText("2 to review")).toBeTruthy();
    expect(screen.getByText("Not funded (6.00 USDG)")).toBeTruthy();
    expect(screen.getAllByText("4.00 USDG").length).toBeGreaterThan(0); // in escrow
    fireEvent.click(screen.getByRole("button", { name: "Refund 2.00 USDG" }));
    expect(await screen.findByText("Refunded 2.00 USDG to your wallet.")).toBeTruthy();
    expect(api.refund).toHaveBeenCalledWith("m1");
  });
});

describe("submission review card", () => {
  const item: ReviewItem = {
    submissionId: "s1",
    status: "needs_review",
    capturedAt: "2026-11-02T09:00:00Z",
    reviewDeadline: "2026-11-05T09:00:00Z",
    location: { lat: -6.17545, lng: 106.82716, accuracyMeters: 8 },
    ai: {
      answer: { is_open: "open", posted_hours: "07:00–21:00" },
      confidence: 0.62,
      reasoning: "Frame 1 shows an OPEN sign.",
      needsReview: true,
      reviewReasons: ["low_confidence"],
      quality: {},
      privacy: { faces: 1, licensePlates: 0, checked: true },
      processedAt: "2026-11-02T09:01:00Z",
    },
    media: {
      type: "photo",
      format: "jpeg_frames",
      frames: [{ url: "https://r2.test/blurred/s1/frame-0.jpg?sig", expiresAt: "x" }],
      url: "x",
      expiresAt: "x",
    },
    proof: { mediaSha256: "ab", onchainSubmissionId: "1", recordTxHash: `0x${"aa".repeat(32)}` },
  };
  const center = { lat: -6.175392, lng: 106.827153 };

  it("shows the blurred media, GPS, AI answer, confidence and review reasons", () => {
    renderWith(
      <SubmissionCard
        item={item}
        meta={meta}
        center={center}
        radius={100}
        reward="2000000"
        onResolved={vi.fn()}
      />,
    );
    expect((screen.getByAltText("Blurred capture, frame 1") as HTMLImageElement).src).toContain(
      "blurred/s1/frame-0.jpg",
    );
    expect(screen.getByText(/-6.17545, 106.82716 ±8 m · \d+ m from center/)).toBeTruthy();
    expect(screen.getByText("open")).toBeTruthy();
    expect(screen.getByText("07:00–21:00")).toBeTruthy();
    expect(screen.getByLabelText("Confidence 62%")).toBeTruthy();
    expect(screen.getByText("low confidence")).toBeTruthy();
  });

  it("accepts on-chain and links the transaction", async () => {
    const api = {
      accept: vi.fn(async () => ({
        submission: { resolveTxHash: "0x1" },
        payout: { amount: "1900000", fee: "100000", txHash: `0x${"cc".repeat(32)}` },
      })),
    };
    const onResolved = vi.fn();
    renderWith(
      <SubmissionCard
        item={item}
        meta={meta}
        center={center}
        radius={100}
        reward="2000000"
        onResolved={onResolved}
      />,
      api as never,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept and pay" }));
    expect(await screen.findByText(/Accepted. Paid 1.90 USDG/)).toBeTruthy();
    expect(
      (screen.getByRole("link", { name: "View transaction" }) as HTMLAnchorElement).href,
    ).toContain(`/tx/0x${"cc".repeat(32)}`);
    expect(onResolved).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Accept and pay" })).toBeNull();
  });

  it("rejects with a reason that fits in 32 bytes", async () => {
    const api = {
      reject: vi.fn(async () => ({ submission: { resolveTxHash: `0x${"dd".repeat(32)}` } })),
    };
    renderWith(
      <SubmissionCard
        item={item}
        meta={meta}
        center={center}
        radius={100}
        reward="2000000"
        onResolved={vi.fn()}
      />,
      api as never,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject…" }));
    const input = screen.getByPlaceholderText(/Reason/);
    const submit = screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "x".repeat(33) } });
    expect(screen.getByText("33/32 bytes")).toBeTruthy();
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "wrong storefront" } });
    await act(async () => fireEvent.click(submit));
    await waitFor(() => expect(api.reject).toHaveBeenCalledWith("s1", "wrong storefront"));
    expect(await screen.findByText(/Rejected. 2.00 USDG stays in escrow/)).toBeTruthy();
  });
});

describe("nav", () => {
  it("highlights the right section", () => {
    expect(isActive("/dashboard", "/dashboard/missions/abc")).toBe(true);
    expect(isActive("/dashboard", "/dashboard/missions/new")).toBe(false);
    expect(isActive("/dashboard/missions/new", "/dashboard/missions/new")).toBe(true);
    expect(isActive("/dashboard/keys", "/dashboard")).toBe(false);
  });
});
