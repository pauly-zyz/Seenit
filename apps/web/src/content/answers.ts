/**
 * Examples for the "Answers, not just footage" section:
 * a capture (drawn as an illustration) next to the structured JSON it produced.
 */

export type SceneKind = "shelf" | "storefront" | "billboard";

export interface AnswerExample {
  id: string;
  label: string;
  scene: SceneKind;
  capture: {
    media: "photo" | "video";
    /** Shown on the recording overlay. */
    timestamp: string;
    gps: string;
    duration?: string;
  };
  answer: Record<string, unknown>;
}

export const answerExamples: AnswerExample[] = [
  {
    id: "shelf",
    label: "Shelf check",
    scene: "shelf",
    capture: { media: "photo", timestamp: "2026-10-19 08:42:13", gps: "37.7793, -122.4192 ±6 m" },
    answer: {
      mission: "oat-milk-shelf-check",
      in_stock: true,
      price: { amount: 4.29, currency: "USD" },
      facings: 6,
      confidence: 0.94,
      location_match: true,
      proof: { media_sha256: "9f2c…e81a", tx: "0x4ab1…07dc" },
    },
  },
  {
    id: "storefront",
    label: "Opening hours",
    scene: "storefront",
    capture: { media: "photo", timestamp: "2026-10-19 07:15:02", gps: "37.7761, -122.4237 ±4 m" },
    answer: {
      mission: "is-luna-bakery-open",
      is_open: false,
      sign_text: "Closed for renovation, back Nov 3",
      hours_posted: null,
      confidence: 0.97,
      location_match: true,
      proof: { media_sha256: "c03d…5b72", tx: "0x91fe…a3c0" },
    },
  },
  {
    id: "billboard",
    label: "Billboard",
    scene: "billboard",
    capture: {
      media: "video",
      timestamp: "2026-10-19 18:03:47",
      gps: "37.7849, -122.4074 ±8 m",
      duration: "0:18",
    },
    answer: {
      mission: "central-junction-screen",
      ad_visible: true,
      creative_match: 0.91,
      screen_on: true,
      rotation_seconds: 12,
      confidence: 0.89,
      proof: { media_sha256: "71aa…0d4e", tx: "0x2c7b…f915" },
    },
  },
];

export const answerPoints = [
  {
    title: "Your schema, your fields",
    body: "Describe the answer you need. Every capture comes back as JSON that matches it.",
  },
  {
    title: "Confidence on every answer",
    body: "Low-confidence results are flagged so your agent knows when to ask again.",
  },
  {
    title: "Linked to the proof",
    body: "Each answer carries the media hash and the transaction that anchored it.",
  },
] as const;
