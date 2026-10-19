import type { PersonhoodProviderId } from "@seenit/shared";

import { HumanPassportProvider, type HumanPassportConfig } from "./human-passport";
import { SelfProvider, type SelfConfig } from "./self";
import type { PersonhoodProvider, PersonhoodProviders } from "./types";

export * from "./types";

/** Builds the enabled providers. A provider with missing config is simply not offered. */
export function createPersonhoodProviders(cfg: {
  humanPassport?: HumanPassportConfig;
  self?: SelfConfig;
}): PersonhoodProviders {
  const list: PersonhoodProvider[] = [];
  if (cfg.humanPassport) list.push(new HumanPassportProvider(cfg.humanPassport));
  if (cfg.self) list.push(new SelfProvider(cfg.self));
  return new Map(list.map((p) => [p.id as PersonhoodProviderId, p]));
}
