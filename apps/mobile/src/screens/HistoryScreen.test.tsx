import { fireEvent, render, screen } from "@testing-library/react-native";

import type { QueueItem } from "../lib/upload-queue";
import { history } from "../test/fixtures";
import { HistoryScreen } from "./HistoryScreen";

const EXPLORER = "https://explorer.testnet.chain.robinhood.com";

function item(over: Partial<QueueItem>): QueueItem {
  return {
    id: "q1",
    missionId: "m9",
    missionTitle: "Parking lot count",
    fileUri: "file:///doc/captures/q1.jpg",
    contentType: "image/jpeg",
    size: 10,
    capture: {} as QueueItem["capture"],
    state: "queued",
    progress: 0,
    attempts: 0,
    nextAttemptAt: 0,
    uploaded: false,
    createdAt: 0,
    ...over,
  };
}

async function setup(queue: QueueItem[] = [], online = true) {
  const api = { getHistory: jest.fn().mockResolvedValue(history()) };
  const props = {
    onRetry: jest.fn(),
    onRemove: jest.fn(),
    onClearDone: jest.fn(),
    openUrl: jest.fn(),
  };
  await render(<HistoryScreen api={api} queue={queue} online={online} {...props} />);
  return { api, ...props };
}

describe("HistoryScreen", () => {
  it("shows the reward balance and statuses", async () => {
    await setup();
    expect(await screen.findByText("3.80 USDG")).toBeTruthy();
    expect(screen.getByText(/2.00 USDG in review · paid to 0x1111…1111/)).toBeTruthy();
    expect(screen.getByText("+1.90 USDG")).toBeTruthy();
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("outside radius")).toBeTruthy();
  });

  it("links transactions and the wallet to the Robinhood Chain explorer", async () => {
    const { openUrl } = await setup();
    await screen.findByText("3.80 USDG");
    await fireEvent.press(screen.getByLabelText("Recorded transaction on explorer"));
    expect(openUrl).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/tx/0x${"a".repeat(64)}$`)),
    );
    await fireEvent.press(screen.getByLabelText("Paid transaction on explorer"));
    expect(openUrl).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/tx/0x${"b".repeat(64)}$`)),
    );
    await fireEvent.press(screen.getByLabelText("View wallet on explorer"));
    expect(openUrl).toHaveBeenLastCalledWith(
      `${EXPLORER}/address/0x1111111111111111111111111111111111111111`,
    );
  });

  it("shows upload progress, offline waiting and retry for failed uploads", async () => {
    const { onRetry, onRemove } = await setup(
      [
        item({ id: "up", state: "uploading", progress: 0.4, missionTitle: "Uploading one" }),
        item({ id: "wait", state: "queued", missionTitle: "Waiting one" }),
        item({
          id: "bad",
          state: "failed",
          attempts: 8,
          lastError: "Upload failed (500)",
          missionTitle: "Failed one",
        }),
      ],
      false,
    );
    await screen.findByText("3.80 USDG");
    expect(screen.getByLabelText("Uploading Uploading one").props.accessibilityValue.now).toBe(40);
    expect(screen.getByText("Waiting for signal")).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Upload failed (500)")).toBeTruthy();
    await fireEvent.press(screen.getByText("Retry now"));
    expect(onRetry).toHaveBeenCalledWith("bad");
    await fireEvent.press(screen.getByText("Remove"));
    expect(onRemove).toHaveBeenCalledWith("bad");
  });

  it("hides finished uploads that already appear as submissions", async () => {
    await setup([
      item({ id: "d", state: "done", submissionId: "s1", missionTitle: "Done upload" }),
    ]);
    await screen.findByText("3.80 USDG");
    expect(screen.queryByText("Done upload")).toBeNull();
  });
});
