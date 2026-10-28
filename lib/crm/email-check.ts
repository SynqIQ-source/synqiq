// Mailgun single-address validation (requirement 7). The address goes in the
// POST body, never in a URL, so it can't end up in request logs.
//
// Mailgun results -> crm_contacts.email_check_status:
//   deliverable                -> deliverable (risky if Mailgun rates it high risk)
//   undeliverable, do_not_send -> undeliverable
//   catch_all                  -> risky (the domain accepts anything, so the
//                                 mailbox can't be confirmed)
//   unknown                    -> unknown

export type EmailCheckStatus = "deliverable" | "undeliverable" | "risky" | "unknown";

export type EmailCheckOutcome = {
  status: EmailCheckStatus;
  // Stored on the contact for staff; the address itself isn't repeated.
  result: {
    provider: "mailgun";
    result: string | null;
    risk: string | null;
    reason: string[];
    did_you_mean: string | null;
    is_disposable: boolean | null;
    is_role: boolean | null;
  };
};

// A failure worth retrying later (network, rate limit, Mailgun outage, or
// no key configured yet), as opposed to a definite answer about the address.
export class EmailCheckRetryableError extends Error {}

const DEFAULT_BASE = "https://api.mailgun.net";

export async function checkEmailWithMailgun(email: string): Promise<EmailCheckOutcome> {
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) throw new EmailCheckRetryableError("MAILGUN_API_KEY is not set");
  const base = process.env.MAILGUN_API_BASE_URL || DEFAULT_BASE;

  let response: Response;
  try {
    response = await fetch(`${base}/v4/address/validate`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}` },
      body: new URLSearchParams({ address: email }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new EmailCheckRetryableError("Mailgun request failed");
  }

  if (!response.ok) {
    // 401/403 (bad key or validation not on the plan), 429 and 5xx are all
    // retried later rather than recorded as a verdict on the address.
    throw new EmailCheckRetryableError(`Mailgun responded ${response.status}`);
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const result = typeof data.result === "string" ? data.result : null;
  const risk = typeof data.risk === "string" ? data.risk : null;

  let status: EmailCheckStatus;
  if (result === "deliverable") status = risk === "high" ? "risky" : "deliverable";
  else if (result === "undeliverable" || result === "do_not_send") status = "undeliverable";
  else if (result === "catch_all") status = "risky";
  else status = "unknown";

  return {
    status,
    result: {
      provider: "mailgun",
      result,
      risk,
      reason: Array.isArray(data.reason) ? data.reason.filter((item): item is string => typeof item === "string") : [],
      did_you_mean: typeof data.did_you_mean === "string" ? data.did_you_mean : null,
      is_disposable: typeof data.is_disposable_address === "boolean" ? data.is_disposable_address : null,
      is_role: typeof data.is_role_address === "boolean" ? data.is_role_address : null,
    },
  };
}
