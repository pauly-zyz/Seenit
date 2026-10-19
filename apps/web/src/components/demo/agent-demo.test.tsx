import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCases } from "@/content/use-cases";
import type * as Motion from "motion/react";

import { motionPrefs } from "../../../vitest.setup";
import { AgentDemo, STEP_DELAYS } from "./agent-demo";

vi.mock("motion/react", async (orig) => ({
  ...(await orig<typeof Motion>()),
  // Treat the demo as on screen, and let each test pick reduced motion.
  useInView: () => true,
  useReducedMotion: () => motionPrefs.reduce,
}));

const first = useCases[0]!;
const second = useCases[1]!;

describe("AgentDemo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    motionPrefs.reduce = false;
  });
  afterEach(() => vi.useRealTimers());

  const playAll = () => {
    for (const d of STEP_DELAYS) {
      act(() => {
        vi.advanceTimersByTime(d);
      });
    }
  };

  it("renders a tab per use case with the first selected", () => {
    render(<AgentDemo useCases={useCases} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(useCases.length);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(first.ask)).toBeTruthy();
  });

  it("plays ask -> draft -> approve -> live mission", () => {
    render(<AgentDemo useCases={useCases} />);
    expect(screen.queryByText(first.plan)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(STEP_DELAYS[0]);
    });
    expect(screen.getByRole("status", { name: "Agent is typing" })).toBeTruthy();
    playAll();
    expect(screen.getByText(first.plan)).toBeTruthy();
    expect(screen.getByText(first.approve)).toBeTruthy();
    expect(screen.getByText(/Escrow funded/)).toBeTruthy();
    expect(
      screen.getByRole("article", { name: `Live mission: ${first.draft.title}` }),
    ).toBeTruthy();
  });

  it("switches use case and restarts the conversation", () => {
    render(<AgentDemo useCases={useCases} />);
    playAll();
    fireEvent.click(screen.getByRole("tab", { name: second.label }));
    expect(screen.getByRole("tab", { name: second.label }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText(second.ask)).toBeTruthy();
    expect(screen.queryByText(second.plan)).toBeNull();
    playAll();
    expect(
      screen.getByRole("article", { name: `Live mission: ${second.draft.title}` }),
    ).toBeTruthy();
  });

  it("supports arrow-key navigation between tabs", () => {
    render(<AgentDemo useCases={useCases} />);
    fireEvent.keyDown(screen.getAllByRole("tab")[0]!, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: second.label }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.keyDown(screen.getAllByRole("tab")[1]!, { key: "End" });
    expect(screen.getAllByRole("tab").at(-1)!.getAttribute("aria-selected")).toBe("true");
  });

  it("shows the whole conversation at once with reduced motion", () => {
    motionPrefs.reduce = true;
    render(<AgentDemo useCases={useCases} />);
    expect(screen.getByText(first.plan)).toBeTruthy();
    expect(
      screen.getByRole("article", { name: `Live mission: ${first.draft.title}` }),
    ).toBeTruthy();
  });
});
