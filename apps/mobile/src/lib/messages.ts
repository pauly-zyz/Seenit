import { ApiError } from "./api";

/** Turns an API error from a verification attempt into a sentence for the contributor. */
export function verificationErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Please try again.";
  const reason = typeof err.details.reason === "string" ? err.details.reason : err.code;
  switch (reason) {
    case "score_too_low": {
      const score = Number(err.details.score ?? 0);
      const required = Number(err.details.requiredScore ?? 0);
      return `Your Human Passport score is ${score.toFixed(1)}. You need ${required} to unlock Tier 1. Add more stamps, then check again.`;
    }
    case "score_error":
    case "score_expired":
      return "Human Passport couldn't score your wallet right now. Refresh your passport and try again.";
    case "nullifier_in_use":
      return "This identity is already linked to another Seenit account. Each person can have one account.";
    case "different_identity":
      return "This account is already verified with a different identity.";
    case "revoked":
      return "This verification was revoked. Contact support if you think this is a mistake.";
    case "attest_failed":
      return "You're verified, but saving it on-chain failed. Try again in a moment.";
    case "provider_unavailable":
    case "provider_unreachable":
      return "The verification provider is busy. Try again in a minute.";
    case "invalid_proof":
      return "The Self proof could not be verified. Please try again in the Self app.";
    case "network_error":
      return err.message;
    default:
      return err.status === 401 ? "Please sign in again." : err.message;
  }
}
