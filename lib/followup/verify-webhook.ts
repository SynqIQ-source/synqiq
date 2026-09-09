import { createHmac, timingSafeEqual } from "node:crypto";

// Resend signs webhooks with the Svix scheme (svix-id / svix-timestamp /
// svix-signature headers, HMAC-SHA256 over "id.timestamp.body", secret is
// base64 after a "whsec_" prefix). This is NOT the bare
// `Authorization: Bearer <CRON_SECRET>` compare the cron routes use -- the
// inbound endpoint is called by Resend, not by our own scheduler, so it
// needs the real signature check.
//
// Implemented directly rather than pulling in the `svix` package: it is a
// dozen lines and avoids another dependency in a codebase that has kept its
// tree small.

const TOLERANCE_SECONDS = 5 * 60;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyResendWebhook(params: {
  secret: string;
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  };
  body: string;
}): VerifyResult {
  const { id, timestamp, signature } = params.headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing svix-id / svix-timestamp / svix-signature" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "non-numeric svix-timestamp" };
  }
  const skew = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (skew > TOLERANCE_SECONDS) {
    return { ok: false, reason: `timestamp outside tolerance (${Math.round(skew)}s)` };
  }

  const secretKey = params.secret.startsWith("whsec_") ? params.secret.slice("whsec_".length) : params.secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(secretKey, "base64");
  } catch {
    return { ok: false, reason: "webhook secret is not valid base64" };
  }

  const signedContent = `${id}.${timestamp}.${params.body}`;
  const expected = createHmac("sha256", keyBytes).update(signedContent).digest();

  // The header is a space-separated list of "<version>,<base64sig>" pairs;
  // any v1 entry matching is a pass.
  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    if (comma === -1) {
      continue;
    }
    const version = part.slice(0, comma);
    if (version !== "v1") {
      continue;
    }
    let provided: Buffer;
    try {
      provided = Buffer.from(part.slice(comma + 1), "base64");
    } catch {
      continue;
    }
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "no matching v1 signature" };
}
