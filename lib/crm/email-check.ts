import { Resolver } from "node:dns/promises";

// Email deliverability check (requirement 7).
//
// Mailgun single-address validation when the account has it. The address
// goes in the POST body, never in a URL, so it can't end up in request logs.
// Mailgun results -> crm_contacts.email_check_status:
//   deliverable                -> deliverable (risky if Mailgun rates it high risk)
//   undeliverable, do_not_send -> undeliverable
//   catch_all                  -> risky (the domain accepts anything, so the
//                                 mailbox can't be confirmed)
//   unknown                    -> unknown
//
// When Mailgun can't validate for this account (no key, key rejected, or
// validation not on the plan -- the 403 The Preserve's plan returns today),
// checkEmail() falls back to a built-in check: the domain must be able to
// receive mail (MX, or an A/AAAA record per RFC 5321), plus a "did you mean"
// for common domain typos. That can't confirm the mailbox exists, so a
// passing address is recorded as "unknown" with provider "dns", shown on the
// profile as "Domain accepts mail". Upgrading the Mailgun plan switches back
// to full checks automatically.

export type EmailCheckStatus = "deliverable" | "undeliverable" | "risky" | "unknown";

export type EmailCheckOutcome = {
  status: EmailCheckStatus;
  // Stored on the contact for staff; the address itself isn't repeated.
  result: {
    provider: "mailgun" | "dns";
    result: string | null;
    risk: string | null;
    reason: string[];
    did_you_mean: string | null;
    is_disposable: boolean | null;
    is_role: boolean | null;
  };
};

// A failure worth retrying later (network, rate limit, Mailgun or DNS
// outage), as opposed to a definite answer about the address.
export class EmailCheckRetryableError extends Error {}

// Mailgun can't validate for this account at all (no key, key rejected, or
// validation not on the plan): use the built-in check instead.
export class MailgunUnavailableError extends Error {}

const DEFAULT_BASE = "https://api.mailgun.net";

export async function checkEmailWithMailgun(email: string): Promise<EmailCheckOutcome> {
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) throw new MailgunUnavailableError("MAILGUN_API_KEY is not set");
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

  if (response.status === 401 || response.status === 403) {
    throw new MailgunUnavailableError(`Mailgun responded ${response.status}`);
  }
  if (!response.ok) {
    // 429 and 5xx are retried later rather than recorded as a verdict.
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

// Common misspellings of the big mail providers' domains.
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmil.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "hotmal.com": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.co": "outlook.com",
  "outlook.con": "outlook.com",
  "iclod.com": "icloud.com",
  "icoud.com": "icloud.com",
  "icloud.co": "icloud.com",
  "icloud.con": "icloud.com",
  "aol.co": "aol.com",
  "aol.con": "aol.com",
};

const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "ENONAME", "NXDOMAIN"]);

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

// Built-in fallback: can the address's domain receive mail at all?
export async function checkEmailWithDns(email: string): Promise<EmailCheckOutcome> {
  const [local, domainRaw] = email.split("@");
  const domain = (domainRaw ?? "").toLowerCase();
  const suggestion = DOMAIN_TYPOS[domain] ? `${local}@${DOMAIN_TYPOS[domain]}` : null;
  const resolver = new Resolver({ timeout: 5000, tries: 2 });

  async function has(kind: "MX" | "A" | "AAAA"): Promise<boolean> {
    try {
      if (kind === "MX") {
        const records = await resolver.resolveMx(domain);
        // A "null MX" (exchange ".") means the domain accepts no mail.
        return records.some((record) => record.exchange !== "" && record.exchange !== ".");
      }
      const records = kind === "A" ? await resolver.resolve4(domain) : await resolver.resolve6(domain);
      return records.length > 0;
    } catch (error) {
      if (NOT_FOUND_CODES.has(errorCode(error))) return false;
      throw new EmailCheckRetryableError(`DNS lookup failed (${errorCode(error) || "error"})`);
    }
  }

  const acceptsMail = (await has("MX")) || (await has("A")) || (await has("AAAA"));
  return {
    status: !acceptsMail ? "undeliverable" : suggestion ? "risky" : "unknown",
    result: {
      provider: "dns",
      result: acceptsMail ? "domain_accepts_mail" : "domain_cannot_receive_mail",
      risk: null,
      reason: suggestion ? ["possible_typo"] : [],
      did_you_mean: suggestion,
      is_disposable: null,
      is_role: null,
    },
  };
}

// Mailgun when the account can validate; otherwise the built-in check.
export async function checkEmail(email: string): Promise<EmailCheckOutcome> {
  try {
    return await checkEmailWithMailgun(email);
  } catch (error) {
    if (error instanceof MailgunUnavailableError) return checkEmailWithDns(email);
    throw error;
  }
}
