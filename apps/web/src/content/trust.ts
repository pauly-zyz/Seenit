export type TrustIcon = "gps" | "chain" | "blur" | "human";

export const trustPoints: { icon: TrustIcon; title: string; body: string }[] = [
  {
    icon: "gps",
    title: "GPS + timestamp at the shutter",
    body: "Every capture is sealed with location and time the moment it's taken. Gallery uploads aren't possible.",
  },
  {
    icon: "chain",
    title: "Hashed on Robinhood Chain",
    body: "The fingerprint of each original recording is anchored on-chain, so anyone can check it was never altered.",
  },
  {
    icon: "blur",
    title: "Faces and plates blurred",
    body: "Bystanders' faces and licence plates are blurred automatically before anything reaches the requester.",
  },
  {
    icon: "human",
    title: "One verified human, one account",
    body: "Contributors prove they're a unique person. No bots, no farms, no one person running ten accounts.",
  },
];
