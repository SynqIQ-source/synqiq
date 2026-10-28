import type { SupabaseClient } from "@supabase/supabase-js";
import { sameName } from "@/lib/crm/normalize";

// Matching against the organization's own CRM contacts (requirement 6).
// Every query is filtered by the organization resolved server-side (kiosk
// device or staff session), never by anything the request supplies.

export type MatchCandidate = {
  id: string;
  first_name: string;
  last_name: string;
  email_normalized: string | null;
  phone_e164: string | null;
};

export type MatchResult =
  // Email AND phone both belong to one contact whose name matches.
  | { kind: "full"; contact: MatchCandidate }
  // Something matched, but not cleanly: only one of email/phone, a
  // different name, or several contacts. Staff resolve it.
  | { kind: "partial"; candidate: MatchCandidate; reason: "partial_match" | "name_mismatch" }
  | { kind: "none" };

export async function findContactMatch(
  admin: SupabaseClient,
  organizationId: string,
  input: { email: string | null; phone: string | null; firstName: string; lastName: string },
): Promise<MatchResult> {
  const filters: string[] = [];
  // Both values are already normalized (lowercased email / E.164 phone),
  // which can't contain the commas or parentheses PostgREST's or() syntax
  // would choke on -- normalizeEmail rejects whitespace, and E.164 is
  // "+" and digits only.
  if (input.email) filters.push(`email_normalized.eq.${input.email}`);
  if (input.phone) filters.push(`phone_e164.eq.${input.phone}`);
  if (filters.length === 0) return { kind: "none" };

  const { data, error } = await admin
    .from("crm_contacts")
    .select("id, first_name, last_name, email_normalized, phone_e164")
    .eq("organization_id", organizationId)
    .is("merged_into_id", null)
    .or(filters.join(","))
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) throw error;
  const candidates = (data ?? []) as MatchCandidate[];
  if (candidates.length === 0) return { kind: "none" };

  const both = candidates.filter(
    (candidate) =>
      input.email !== null &&
      input.phone !== null &&
      candidate.email_normalized === input.email &&
      candidate.phone_e164 === input.phone,
  );

  if (both.length === 1 && candidates.length === 1) {
    const contact = both[0];
    const nameMatches = sameName(contact.first_name, input.firstName) && sameName(contact.last_name, input.lastName);
    return nameMatches
      ? { kind: "full", contact }
      : { kind: "partial", candidate: contact, reason: "name_mismatch" };
  }

  return { kind: "partial", candidate: both[0] ?? candidates[0], reason: "partial_match" };
}

// "Jane D." -- the only thing the kiosk ever shows about an existing contact.
export function firstNameLastInitial(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0).toUpperCase();
  return initial ? `${firstName.trim()} ${initial}.` : firstName.trim();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Requirement 5b: match a typed member name to synced Mindbody clients with
// an Active membership. Exactly one match links them; zero or several leaves
// the typed name for staff to resolve. Nothing about the result is ever
// returned to the kiosk.
export async function resolveReferringMember(
  admin: SupabaseClient,
  organizationId: string,
  typedName: string,
): Promise<string | null> {
  const parts = typedName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts.slice(1).join(" ");

  const { data, error } = await admin
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "Active")
    .ilike("first_name", escapeLike(first))
    .ilike("last_name", escapeLike(last))
    .limit(2);

  if (error) throw error;
  return data && data.length === 1 ? data[0].id : null;
}
