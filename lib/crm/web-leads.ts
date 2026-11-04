import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/crm/http";
import { cleanText, normalizeEmail, normalizePhone } from "@/lib/crm/normalize";

// Parsing for website form submissions (see app/api/crm/web-leads/[token]).
// Website builders all name their fields differently, so this accepts the
// common spellings: Craft Freeform's handles on The Preserve's contact form
// (fullName, email, phone, message, optInToEmailCommunications,
// optInToSMSCommunications) plus the usual first/last/name/phone variants
// from WordPress, Webflow, Squarespace and Zapier. Anything else the form
// sends is kept as "extra details" in the guest's thread, not dropped.

export function newLeadFormToken(): string {
  return randomBytes(24).toString("base64url");
}

export function leadFormUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/api/crm/web-leads/${token}`;
}

export type WebLead = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  // Raw values that were present but didn't parse (shown to staff).
  invalidEmail: string | null;
  invalidPhone: string | null;
  message: string | null;
  emailConsent: boolean;
  smsConsent: boolean;
  extras: [string, string][];
  // A stable id for the submission when the sender provides one (retries).
  submissionId: string | null;
};

const ALIASES = {
  fullName: ["fullname", "name", "yourname", "full_name", "contactname"],
  firstName: ["firstname", "first_name", "fname", "first", "givenname"],
  lastName: ["lastname", "last_name", "lname", "last", "surname", "familyname"],
  email: ["email", "emailaddress", "email_address", "youremail", "e_mail"],
  phone: ["phone", "phonenumber", "phone_number", "mobile", "mobilephone", "cell", "tel", "telephone", "yourphone"],
  message: ["message", "comments", "comment", "notes", "note", "questions", "question", "inquiry", "yourmessage", "details"],
  emailConsent: ["optintoemailcommunications", "emailoptin", "email_opt_in", "emailconsent", "email_consent", "optinemail"],
  smsConsent: ["optintosmscommunications", "smsoptin", "sms_opt_in", "smsconsent", "sms_consent", "optinsms", "textoptin"],
  submissionId: ["submissionid", "submission_id", "uid", "entryid", "entry_id"],
} as const;

// Housekeeping fields form tools add that staff never need to see.
const IGNORED = new Set([
  "action",
  "formhash",
  "craft_csrf_token",
  "csrf_token",
  "_token",
  "form_page_submit",
  "g-recaptcha-response",
  "h-captcha-response",
  "cf-turnstile-response",
  "freeform_payload",
  "id",
  "datecreated",
  "dateupdated",
  "date_created",
  "title",
  "statusid",
  "status",
  "formid",
  "form_id",
  "ip",
  "ipaddress",
  "useragent",
  "token",
  "honeypot",
  "spam",
  "isspam",
]);

// Keys are compared case-insensitively with spaces/dashes folded into "_" and
// then stripped, so "First Name", "first-name" and "firstName" all match.
function foldKey(key: string): string {
  return key.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function matches(key: string, aliases: readonly string[]): boolean {
  const folded = foldKey(key);
  const bare = folded.replace(/_/g, "");
  return aliases.some((alias) => alias === folded || alias.replace(/_/g, "") === bare);
}

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(scalar).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function truthy(value: string | null): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on", "y", "checked", "agree", "i agree"].includes(value.trim().toLowerCase());
}

// Flattens the posted fields. JSON senders sometimes nest the values under
// "fields", "values", "data", "submission" or "form_response"; one level of
// that nesting is unwrapped. Repeated keys (form posts of a hidden "0" plus a
// checked "1") keep the last non-empty value, which is what the browser meant.
export function flattenFields(input: Record<string, unknown>): Map<string, string> {
  const fields = new Map<string, string>();
  const add = (key: string, value: unknown) => {
    if (fields.size >= 80 || key.length > 80) return;
    const text = scalar(value);
    if (text !== null) fields.set(key, text.slice(0, 5000));
    else if (!fields.has(key)) fields.set(key, "");
  };
  for (const [key, value] of Object.entries(input)) {
    const nestable = ["fields", "values", "data", "submission", "form_response", "payload"].includes(foldKey(key));
    if (nestable && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
        // {"fields": {"email": {"value": "a@b.co", "label": "Email"}}}
        if (innerValue && typeof innerValue === "object" && !Array.isArray(innerValue) && "value" in innerValue) {
          add(innerKey, (innerValue as { value: unknown }).value);
        } else {
          add(innerKey, innerValue);
        }
      }
    } else {
      add(key, value);
    }
  }
  return fields;
}

function humanLabel(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function parseWebLead(fields: Map<string, string>): WebLead {
  const used = new Set<string>();
  const pick = (aliases: readonly string[]): string | null => {
    for (const [key, value] of fields) {
      if (matches(key, aliases)) {
        used.add(key);
        if (value) return value;
      }
    }
    return null;
  };

  const fullName = cleanText(pick(ALIASES.fullName), 120);
  let firstName = cleanText(pick(ALIASES.firstName), 60);
  let lastName = cleanText(pick(ALIASES.lastName), 60);
  if (!firstName && fullName) {
    const parts = fullName.split(" ");
    firstName = parts[0].slice(0, 60);
    lastName = lastName ?? (parts.slice(1).join(" ").slice(0, 60) || null);
  }

  const emailRaw = pick(ALIASES.email);
  const phoneRaw = pick(ALIASES.phone);
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const message = cleanMessage(pick(ALIASES.message));
  const emailConsent = truthy(pick(ALIASES.emailConsent));
  const smsConsent = truthy(pick(ALIASES.smsConsent));
  const submissionId = cleanText(pick(ALIASES.submissionId), 100);

  const extras: [string, string][] = [];
  for (const [key, value] of fields) {
    if (used.has(key) || !value || key.startsWith("_") || IGNORED.has(foldKey(key))) {
      continue;
    }
    extras.push([humanLabel(key), value.slice(0, 1000)]);
    if (extras.length >= 25) break;
  }

  // A lead with no name still counts; staff can rename it.
  if (!firstName) {
    firstName = email ? email.split("@")[0].slice(0, 60) : "Website";
    lastName = lastName ?? (email ? "" : "visitor");
  }

  return {
    firstName,
    lastName: lastName ?? "",
    email,
    phone,
    invalidEmail: emailRaw && !email ? emailRaw.slice(0, 200) : null,
    invalidPhone: phoneRaw && !phone ? phoneRaw.slice(0, 50) : null,
    message,
    emailConsent,
    smsConsent,
    extras,
    submissionId,
  };
}

function cleanMessage(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? text.slice(0, 5000) : null;
}

// What goes in the guest's thread: their message, then any extra fields.
export function webLeadThreadBody(lead: WebLead, formName: string): string {
  const lines: string[] = [];
  lines.push(lead.message ?? `Submitted the "${formName}" form on the website.`);
  const details: [string, string][] = [...lead.extras];
  if (lead.invalidEmail) details.unshift(["Email (didn't look valid)", lead.invalidEmail]);
  if (lead.invalidPhone) details.unshift(["Phone (didn't look valid)", lead.invalidPhone]);
  if (details.length) {
    lines.push("");
    for (const [label, value] of details) lines.push(`${label}: ${value}`);
  }
  return lines.join("\n");
}

// Shared by create and edit: the optional "how did you hear" label must be
// one of the org's options and the optional owner one of its active staff.
export async function validateLeadFormSettings(
  admin: SupabaseClient,
  organizationId: string,
  body: Record<string, unknown> | null,
): Promise<{ howHeardLabel: string | null; assignedStaffId: string | null } | { error: string }> {
  let howHeardLabel: string | null = null;
  if (body?.howHeardLabel) {
    const label = cleanText(body.howHeardLabel, 60);
    const { data } = await admin
      .from("crm_marketing_sources")
      .select("label")
      .eq("organization_id", organizationId)
      .eq("label", label ?? "")
      .maybeSingle();
    if (!data) return { error: "Pick a 'how did you hear' option from the list." };
    howHeardLabel = data.label;
  }
  let assignedStaffId: string | null = null;
  if (body?.assignedStaffId) {
    if (!isUuid(body.assignedStaffId)) return { error: "Pick someone from the list." };
    const { data } = await admin
      .from("staff")
      .select("id")
      .eq("id", body.assignedStaffId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .maybeSingle();
    if (!data) return { error: "Pick someone from the list." };
    assignedStaffId = data.id;
  }
  return { howHeardLabel, assignedStaffId };
}
