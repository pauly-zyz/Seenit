import type { SubmissionStatus } from "../lib/api";
import type { QueueState } from "../lib/upload-queue";

type Tone = "lime" | "verify" | "muted" | "danger" | "warn" | "ink";

/** Contributor-facing status: processing / accepted / rejected, plus upload states. */
export function submissionStatusLabel(status: SubmissionStatus): { label: string; tone: Tone } {
  switch (status) {
    case "accepted":
      return { label: "Accepted", tone: "verify" };
    case "rejected":
    case "rejected_precheck":
      return { label: "Rejected", tone: "danger" };
    case "processing":
    case "ready":
    case "chain_failed": // the server retries the on-chain record
      return { label: "Processing", tone: "warn" };
    case "awaiting_upload":
      return { label: "Uploading", tone: "muted" };
  }
}

export function queueStateLabel(state: QueueState, online: boolean): { label: string; tone: Tone } {
  switch (state) {
    case "queued":
      return { label: online ? "Waiting to upload" : "Waiting for signal", tone: "muted" };
    case "uploading":
      return { label: "Uploading", tone: "ink" };
    case "finalizing":
      return { label: "Verifying", tone: "ink" };
    case "done":
      return { label: "Submitted", tone: "verify" };
    case "rejected":
      return { label: "Rejected", tone: "danger" };
    case "failed":
      return { label: "Upload failed", tone: "danger" };
  }
}
