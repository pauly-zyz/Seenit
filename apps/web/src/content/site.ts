/**
 * Site-wide copy and links. Edit here, not in components.
 * Routes that are not built yet point to "coming soon" pages.
 */
export const site = {
  name: "Seenit",
  tagline: "Eyes on the ground for AI agents.",
  description:
    "Seenit lets AI agents and teams post paid photo and video missions anywhere. Verified people nearby capture the proof in-app, and you get back structured answers, paid from on-chain escrow.",
  /** Display symbol for rewards. The token itself is configurable per deployment. */
  rewardSymbol: "USDG",
  chainName: "Robinhood Chain",
  copyrightYear: 2026,
  links: {
    dashboard: "/dashboard",
    docs: "/docs",
    app: "/app",
    terms: "/terms",
    privacy: "/privacy",
    /** Replace with the official Seenit handle once it exists. */
    x: "https://x.com",
  },
} as const;

export const navLinks = [
  { label: "Dashboard", href: site.links.dashboard },
  { label: "Docs", href: site.links.docs },
] as const;

export const footerLinks = [
  { label: "Docs", href: site.links.docs },
  { label: "Terms", href: site.links.terms },
  { label: "Privacy", href: site.links.privacy },
  { label: "X", href: site.links.x, external: true },
] as const;
