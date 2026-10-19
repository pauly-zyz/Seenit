/**
 * Use cases for the "For agents & funders" chat demo.
 * Each one plays as: user asks -> agent drafts a paid mission -> user approves -> mission goes live.
 * Places and brands are fictional.
 */

export type UseCaseIcon = "basket" | "crane" | "store" | "billboard" | "crowd";
export type MediaKind = "photo" | "video";

export interface MissionDraft {
  title: string;
  place: string;
  /** Reward per accepted capture, decimal string in the reward token (e.g. "3.00"). */
  reward: string;
  /** Number of independent captures wanted. */
  slots: number;
  radiusMeters: number;
  expiresIn: string;
  media: MediaKind;
  /** Max clip length for video missions. */
  videoSeconds?: number;
  /** Personhood tier required. Must match the escrow rule (see content tests). */
  tier: 1 | 2;
  /** Fields the structured answer will contain. */
  answerFields: string[];
}

export interface UseCase {
  id: string;
  label: string;
  icon: UseCaseIcon;
  /** What the user asks the agent. */
  ask: string;
  /** Agent's reply while drafting the mission. */
  plan: string;
  draft: MissionDraft;
  /** User's approval message. */
  approve: string;
  /** How many contributors are nearby when it goes live. */
  nearby: number;
}

export const useCases: UseCase[] = [
  {
    id: "stock",
    label: "Store stock check",
    icon: "basket",
    ask: "Is the 1L oat milk back on the shelf at Greenleaf Market on Pine St? I want to know before I place a bulk order.",
    plan: "I'll send someone to the dairy aisle. One sharp photo of the shelf with price tags in frame is enough.",
    draft: {
      title: "Oat milk 1L shelf check",
      place: "Greenleaf Market, Pine St",
      reward: "3.00",
      slots: 2,
      radiusMeters: 150,
      expiresIn: "90 min",
      media: "photo",
      tier: 1,
      answerFields: ["in_stock", "price", "facings"],
    },
    approve: "Looks right. Fund it.",
    nearby: 14,
  },
  {
    id: "construction",
    label: "Construction progress",
    icon: "crane",
    ask: "The contractor says the third-floor slab at the Harbor Lofts site is poured. Can I see proof this week?",
    plan: "I'll book a short walk-around clip from the public sidewalk, framed like last week's capture so you can compare.",
    draft: {
      title: "Harbor Lofts floor 3 status",
      place: "Harbor Lofts site, Quay Rd",
      reward: "12.00",
      slots: 1,
      radiusMeters: 200,
      expiresIn: "3 days",
      media: "video",
      videoSeconds: 30,
      tier: 2,
      answerFields: ["floors_visible", "slab_complete", "crane_on_site"],
    },
    approve: "Approved. Send me the answer when it lands.",
    nearby: 6,
  },
  {
    id: "open",
    label: "Is it open?",
    icon: "store",
    ask: "Maps says Luna Bakery opens at 7, but a review says it's shut for renovation. Which is it right now?",
    plan: "Quick one. A photo of the entrance plus any posted notice will settle it.",
    draft: {
      title: "Is Luna Bakery open?",
      place: "Luna Bakery, Orchard Ave",
      reward: "1.50",
      slots: 3,
      radiusMeters: 100,
      expiresIn: "45 min",
      media: "photo",
      tier: 1,
      answerFields: ["is_open", "sign_text", "hours_posted"],
    },
    approve: "Yes, go.",
    nearby: 21,
  },
  {
    id: "billboard",
    label: "Billboard proof",
    icon: "billboard",
    ask: "Our campaign should be running on the digital screen at Central Junction from today. Is it actually showing?",
    plan: "I'll ask for two independent clips an hour apart, so you get proof of rotation, not one lucky frame.",
    draft: {
      title: "Central Junction screen check",
      place: "Central Junction, east facade",
      reward: "4.00",
      slots: 2,
      radiusMeters: 250,
      expiresIn: "6 h",
      media: "video",
      videoSeconds: 20,
      tier: 1,
      answerFields: ["ad_visible", "creative_match", "screen_on"],
    },
    approve: "Perfect, approve.",
    nearby: 33,
  },
  {
    id: "crowd",
    label: "Event crowd",
    icon: "crowd",
    ask: "How busy is the Riverside night market right now? Deciding whether to send our food truck tonight.",
    plan: "I'll ask for a slow pan of the main walkway and estimate density and queue length from it.",
    draft: {
      title: "Riverside night market crowd",
      place: "Riverside night market",
      reward: "2.50",
      slots: 3,
      radiusMeters: 300,
      expiresIn: "30 min",
      media: "video",
      videoSeconds: 15,
      tier: 1,
      answerFields: ["crowd_level", "queue_minutes", "weather"],
    },
    approve: "Do it.",
    nearby: 48,
  },
];

/** Total escrowed for a draft (reward x slots), formatted with 2 decimals. */
export function escrowTotal(draft: Pick<MissionDraft, "reward" | "slots">): string {
  const [whole = "0", frac = ""] = draft.reward.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  const total = cents * draft.slots;
  return `${Math.floor(total / 100)}.${String(total % 100).padStart(2, "0")}`;
}
