import { eq, funders } from "@seenit/db";

import { randomToken } from "../crypto";
import { AppError } from "../errors";
import {
  checkWebhookUrl,
  UnsafeWebhookUrlError,
  webhookSecretContext,
} from "../processing/webhooks";
import type { Services } from "../services";

function requireCipher(s: Services) {
  if (!s.cipher) throw new AppError("internal_error", "Webhooks are not configured on this server");
  return s.cipher;
}

export async function getWebhook(s: Services, funderId: string) {
  const f = await s.db.query.funders.findFirst({ where: eq(funders.id, funderId) });
  return { url: f?.webhookUrl ?? null, events: ["submission.processed"] };
}

/** Sets the webhook URL and issues a new signing secret (shown once). */
export async function setWebhook(s: Services, funderId: string, rawUrl: string) {
  const cipher = requireCipher(s);
  let url: URL;
  try {
    url = checkWebhookUrl(rawUrl, { allowHttp: s.config.webhookAllowHttp });
  } catch (err) {
    if (err instanceof UnsafeWebhookUrlError) throw new AppError("validation_failed", err.message);
    throw err;
  }
  const secret = `whsec_${randomToken(32)}`;
  await s.db
    .update(funders)
    .set({
      webhookUrl: url.toString(),
      webhookSecretEnc: cipher.encryptString(secret, webhookSecretContext(funderId)),
    })
    .where(eq(funders.id, funderId));
  return {
    url: url.toString(),
    secret,
    events: ["submission.processed"],
    signature: "Seenit-Signature: t=<unix>,v1=hex(HMAC-SHA256(secret, `${t}.${rawBody}`))",
  };
}

export async function deleteWebhook(s: Services, funderId: string) {
  await s.db
    .update(funders)
    .set({ webhookUrl: null, webhookSecretEnc: null })
    .where(eq(funders.id, funderId));
  return { url: null };
}
