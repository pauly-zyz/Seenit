import { describe, expect, it } from "vitest";

import { canonicalJson, missionSpecSchema, type MissionSpecInput } from "../src/index.js";

const valid: MissionSpecInput = {
  title: "Is the bakery open?",
  instructions: "Take one photo of the front door showing the open/closed sign.",
  mediaType: "photo",
  location: { lat: -6.2, lng: 106.8 },
  radiusMeters: 100,
  rewardPerSubmission: "2000000",
  maxSubmissions: 3,
  deadline: "2026-12-01T00:00:00Z",
  outputSchema: { type: "object", properties: { open: { type: "boolean" } }, required: ["open"] },
};

describe("missionSpecSchema", () => {
  it("accepts a valid photo mission and defaults minTier to 1", () => {
    const parsed = missionSpecSchema.parse(valid);
    expect(parsed.minTier).toBe(1);
  });

  it("requires maxVideoSeconds for video", () => {
    const res = missionSpecSchema.safeParse({ ...valid, mediaType: "video" });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["maxVideoSeconds"]);
    expect(missionSpecSchema.safeParse({ ...valid, mediaType: "video", maxVideoSeconds: 30 }).success).toBe(
      true,
    );
  });

  it.each([
    ["zero reward", { rewardPerSubmission: "0" }],
    ["decimal reward", { rewardPerSubmission: "1.5" }],
    ["leading zero reward", { rewardPerSubmission: "01" }],
    ["reward over uint128", { rewardPerSubmission: (1n << 128n).toString() }],
    ["radius too small", { radiusMeters: 5 }],
    ["radius too large", { radiusMeters: 10_000 }],
    ["bad latitude", { location: { lat: 91, lng: 0 } }],
    ["no submissions", { maxSubmissions: 0 }],
    ["tier 0", { minTier: 0 }],
    ["bad deadline", { deadline: "tomorrow" }],
    ["non-object output schema", { outputSchema: { type: "string" } }],
    ["short title", { title: "hi" }],
  ])("rejects %s", (_, patch) => {
    expect(missionSpecSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively and is stable", () => {
    const a = canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" } });
    const b = canonicalJson({ a: { c: "x", d: [1, { y: 2, z: 1 }] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
  });

  it("drops undefined properties and rejects non-JSON values", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(undefined)).toThrow();
  });
});
