import { describe, expect, it } from "vitest";

import { haversineMeters, isWithinRadius } from "../src/index.js";

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters({ lat: -6.2, lng: 106.8 }, { lat: -6.2, lng: 106.8 })).toBe(0);
  });

  it("matches a known distance (Monas -> Bundaran HI, about 2.4 km)", () => {
    const monas = { lat: -6.175392, lng: 106.827153 };
    const bundaranHI = { lat: -6.195004, lng: 106.823039 };
    const d = haversineMeters(monas, bundaranHI);
    expect(d).toBeGreaterThan(2_150);
    expect(d).toBeLessThan(2_300);
  });

  it("is symmetric", () => {
    const a = { lat: 40.7128, lng: -74.006 };
    const b = { lat: 51.5074, lng: -0.1278 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
    expect(haversineMeters(a, b) / 1000).toBeCloseTo(5570, -1);
  });

  it("handles the antimeridian", () => {
    expect(haversineMeters({ lat: 0, lng: 179.9999 }, { lat: 0, lng: -179.9999 })).toBeLessThan(30);
  });
});

describe("isWithinRadius", () => {
  const center = { lat: 0, lng: 0 };
  it("includes points inside and on the edge", () => {
    // 0.001 deg latitude is about 111 m
    expect(isWithinRadius(center, 120, { lat: 0.001, lng: 0 })).toBe(true);
    expect(isWithinRadius(center, 100, { lat: 0.001, lng: 0 })).toBe(false);
  });
});
