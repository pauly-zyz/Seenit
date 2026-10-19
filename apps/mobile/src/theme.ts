/** Seenit visual identity (matches the landing page): ink + lime, paper background. */
export const colors = {
  ink: "#0e1116",
  paper: "#f7f7f2",
  surface: "#ffffff",
  surface2: "#efefe8",
  line: "#e2e2d9",
  muted: "#535a65",
  lime: "#c8f051",
  limeInk: "#496600",
  verify: "#0b7a6e",
  verifySoft: "#e6f5f2",
  rec: "#d93a3f",
  danger: "#b42318",
  dangerSoft: "#fdecea",
  warn: "#9a6700",
  warnSoft: "#fff4d6",
} as const;

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const type = {
  eyebrow: { fontSize: 12, letterSpacing: 1.4, fontWeight: "600" as const, color: colors.limeInk },
  title: { fontSize: 28, fontWeight: "700" as const, color: colors.ink, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: "700" as const, color: colors.ink },
  body: { fontSize: 15, lineHeight: 21, color: colors.ink },
  muted: { fontSize: 14, lineHeight: 20, color: colors.muted },
  small: { fontSize: 12, color: colors.muted },
  mono: { fontFamily: "monospace", fontSize: 12, color: colors.ink },
};
