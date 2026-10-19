import {
  Construction,
  MonitorPlay,
  ShoppingBasket,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { MissionDraft, UseCaseIcon } from "@/content/use-cases";

export const useCaseIcons: Record<UseCaseIcon, LucideIcon> = {
  basket: ShoppingBasket,
  crane: Construction,
  store: Store,
  billboard: MonitorPlay,
  crowd: Users,
};

export function tierLabel(tier: MissionDraft["tier"]): string {
  return tier === 2 ? "Tier 2 · ID-verified humans" : "Tier 1 · verified humans";
}

export function proofLabel(draft: Pick<MissionDraft, "media" | "videoSeconds">): string {
  return draft.media === "video" ? `Video, up to ${draft.videoSeconds ?? 30}s` : "1 photo";
}
