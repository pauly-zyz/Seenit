import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  checkOutputSchema,
  dropNullOptionals,
  missionSpecSchema,
  OUTPUT_SCHEMA_TEMPLATES,
  OUTPUT_TEMPLATE_IDS,
  toModelSchema,
} from "../src/index.js";

const fromSchema = (s: object) => z.fromJSONSchema(s as Parameters<typeof z.fromJSONSchema>[0]);

const simple = {
  type: "object",
  properties: {
    is_open: { type: "boolean" },
    count: { type: "integer", minimum: 0, maximum: 50 },
    note: { type: "string", maxLength: 10 },
  },
  required: ["is_open", "count"],
};

describe("checkOutputSchema", () => {
  it("accepts a simple object schema and every template", () => {
    expect(checkOutputSchema(simple)).toEqual([]);
    for (const id of OUTPUT_TEMPLATE_IDS)
      expect(checkOutputSchema(OUTPUT_SCHEMA_TEMPLATES[id].outputSchema)).toEqual([]);
  });

  it.each([
    ["non-object root", { type: "string" }, 'type: "object"'],
    ["no properties", { type: "object", properties: {} }, "at least one property"],
    ["$ref", { type: "object", properties: { a: { $ref: "#/x" } } }, "$ref is not supported"],
    [
      "open objects",
      { type: "object", properties: { a: { type: "string" } }, additionalProperties: true },
      "may only be false",
    ],
    [
      "unknown type",
      { type: "object", properties: { a: { type: "date" } } },
      'type "date" is not valid',
    ],
    [
      "unsupported format",
      { type: "object", properties: { a: { type: "string", format: "regex" } } },
      "format",
    ],
    [
      "required not declared",
      { type: "object", properties: { a: { type: "string" } }, required: ["b"] },
      "required",
    ],
    ["untyped", { type: "object", properties: { a: { description: "x" } } }, "needs a type"],
  ])("rejects %s", (_name, schema, message) => {
    expect(checkOutputSchema(schema).join("\n")).toContain(message);
  });

  it("rejects deep nesting", () => {
    let node: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 8; i++) node = { type: "object", properties: { n: node } };
    expect(checkOutputSchema(node).join()).toContain("deeper");
  });

  it("is enforced by missionSpecSchema", () => {
    const base = {
      title: "Open?",
      instructions: "Photograph the entrance clearly.",
      mediaType: "photo",
      location: { lat: 0, lng: 0 },
      radiusMeters: 100,
      rewardPerSubmission: "1000000",
      maxSubmissions: 1,
      deadline: "2030-01-01T00:00:00Z",
    };
    expect(missionSpecSchema.safeParse({ ...base, outputSchema: simple }).success).toBe(true);
    expect(
      missionSpecSchema.safeParse({
        ...base,
        outputSchema: { type: "object", properties: { a: { $ref: "x" } } },
      }).success,
    ).toBe(false);
  });
});

describe("toModelSchema", () => {
  it("closes objects, requires every key, makes optional keys nullable and strips local-only constraints", () => {
    expect(toModelSchema(simple)).toEqual({
      type: "object",
      properties: {
        is_open: { type: "boolean" },
        count: { type: "integer" },
        note: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["is_open", "count", "note"],
      additionalProperties: false,
    });
  });

  it("recurses into arrays and nested objects", () => {
    const out = toModelSchema({
      type: "object",
      properties: {
        items: {
          type: "array",
          maxItems: 3,
          items: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        },
      },
      required: ["items"],
    });
    expect(out.properties).toEqual({
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { a: { type: "string" } },
          required: ["a"],
          additionalProperties: false,
        },
      },
    });
  });
});

describe("dropNullOptionals + local validation", () => {
  it("turns model nulls back into absent optional keys, then Zod enforces the original constraints", () => {
    const validator = fromSchema(simple);
    const fromModel = { is_open: true, count: 3, note: null };
    expect(validator.safeParse(fromModel).success).toBe(false);
    expect(validator.safeParse(dropNullOptionals(simple, fromModel)).success).toBe(true);
    expect(validator.safeParse({ is_open: true, count: 99 }).success).toBe(false); // maximum enforced locally
  });

  it("every template validates with Zod after conversion", () => {
    for (const id of OUTPUT_TEMPLATE_IDS) {
      const t = OUTPUT_SCHEMA_TEMPLATES[id];
      expect(() => fromSchema(t.outputSchema)).not.toThrow();
      expect(toModelSchema(t.outputSchema).additionalProperties).toBe(false);
    }
  });
});
