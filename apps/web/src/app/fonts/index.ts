import localFont from "next/font/local";

export { GeistSans } from "geist/font/sans";

/**
 * Geist Mono is only used below the fold (code, labels), so it is not preloaded.
 * That keeps the sans font, which the hero text needs, first in line.
 */
export const GeistMono = localFont({
  src: "../../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  preload: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});
