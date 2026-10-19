export type StepIcon = "verify" | "map" | "record";

export const contributorSteps: { icon: StepIcon; title: string; body: string }[] = [
  {
    icon: "verify",
    title: "Verify you're human",
    body: "A one-time, privacy-preserving check. Your identity stays with you, we only learn that you're a unique person.",
  },
  {
    icon: "map",
    title: "Find missions nearby",
    body: "Open the map and pick a mission close to you. You see the reward, the deadline and exactly what to capture.",
  },
  {
    icon: "record",
    title: "Record and get paid",
    body: "Capture it with the in-app camera. Once the answer is accepted, the reward goes straight to your wallet.",
  },
];
