import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { createMindbodyClient } from "@/lib/mindbody/client";

// Sends a CRM contact to Mindbody (requirement 13, as decided with the
// studio on 2026-10-28):
//   - search Mindbody by email, then phone; on a match, LINK the contact to
//     that client (no duplicate is created)
//   - otherwise create the client with AddClient, filling the fields the
//     site's GetRequiredClientFields demands, with the guest's email opt-in
//   - no waiver upload and no LiabilityRelease (waivers stay in SynqIQ), no
//     photo, and SMS consent stays in SynqIQ (Mindbody's API can't set it)
// Uses the same staff login the syncs use (MINDBODY_USERNAME/PASSWORD) and
// only for the org whose Mindbody site matches MINDBODY_SITE_ID.

type Contact = {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  email_normalized: string | null;
  phone_e164: string | null;
  date_of_birth: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  email_consent: boolean;
  mindbody_client_id: string | null;
};

type MindbodyClientRow = {
  Id?: string | number;
  Email?: string | null;
  MobilePhone?: string | null;
  HomePhone?: string | null;
  WorkPhone?: string | null;
};

// A push that can't succeed until staff change something (Mindbody wants a
// field the contact doesn't have). Not retried; shown on the profile.
export class MindbodyPushBlockedError extends Error {}

function lastTenDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}

function nationalDigits(e164: string | null): string | null {
  if (!e164) return null;
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? String(parsed.nationalNumber) : null;
}

// Mindbody error text can echo submitted values; keep the status and the
// gist, with anything that looks like an email or phone number removed.
export function sanitizeMindbodyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Mindbody request failed";
  return message
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .slice(0, 300);
}

async function findExistingClient(
  mindbody: ReturnType<typeof createMindbodyClient>,
  token: string,
  contact: Contact,
): Promise<string | null> {
  if (contact.email_normalized) {
    const result = (await mindbody.searchClients(contact.email_normalized, token)) as { Clients?: MindbodyClientRow[] };
    const match = (result.Clients ?? []).find(
      (client) => (client.Email ?? "").trim().toLowerCase() === contact.email_normalized,
    );
    if (match?.Id !== undefined) return String(match.Id);
  }
  const phone = lastTenDigits(contact.phone_e164);
  if (phone.length === 10) {
    const result = (await mindbody.searchClients(phone, token)) as { Clients?: MindbodyClientRow[] };
    const match = (result.Clients ?? []).find((client) =>
      [client.MobilePhone, client.HomePhone, client.WorkPhone].some((value) => lastTenDigits(value) === phone),
    );
    if (match?.Id !== undefined) return String(match.Id);
  }
  return null;
}

// Returns the Mindbody client id the contact is now linked to, and whether
// it was an existing client (linked) or a new one (created).
export async function pushContactToMindbody(
  admin: SupabaseClient,
  contactId: string,
  organizationId: string,
): Promise<{ clientId: string; linked: boolean } | { skipped: string }> {
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("mindbody_site_id, mindbody_connected, crm_mindbody_push")
    .eq("id", organizationId)
    .single();
  if (orgError) throw orgError;
  if (!org.crm_mindbody_push) return { skipped: "Mindbody push is off for this studio" };
  if (!org.mindbody_connected) {
    return { skipped: "This studio's Mindbody site isn't connected" };
  }

  const { data, error } = await admin
    .from("crm_contacts")
    .select(
      "id, organization_id, first_name, last_name, email, email_normalized, phone_e164, date_of_birth, address_line1, city, state, postal_code, email_consent, mindbody_client_id",
    )
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .single();
  if (error) throw error;
  const contact = data as Contact;
  if (contact.mindbody_client_id) return { clientId: contact.mindbody_client_id, linked: true };

  const mindbody = createMindbodyClient({ siteId: String(org.mindbody_site_id) });
  const auth = (await mindbody.authenticate()) as { AccessToken?: string };
  if (!auth.AccessToken) throw new Error("Mindbody login returned no token");
  const token = auth.AccessToken;

  const existing = await findExistingClient(mindbody, token, contact);
  if (existing) return { clientId: existing, linked: true };

  const fields: Record<string, unknown> = {
    FirstName: contact.first_name,
    LastName: contact.last_name,
    Email: contact.email_normalized ?? undefined,
    MobilePhone: nationalDigits(contact.phone_e164) ?? undefined,
    BirthDate: contact.date_of_birth ? `${contact.date_of_birth}T00:00:00` : undefined,
    AddressLine1: contact.address_line1 ?? undefined,
    City: contact.city ?? undefined,
    State: contact.state ?? undefined,
    PostalCode: contact.postal_code ?? undefined,
    Country: contact.address_line1 ? "US" : undefined,
    SendPromotionalEmails: contact.email_consent,
  };

  const required = (await mindbody.getRequiredClientFields(token)) as { RequiredClientFields?: string[] };
  const missing = (required.RequiredClientFields ?? []).filter(
    (field) => fields[field] === undefined || fields[field] === null || fields[field] === "",
  );
  if (missing.length > 0) {
    throw new MindbodyPushBlockedError(`Mindbody requires: ${missing.join(", ")}`);
  }

  const created = (await mindbody.addClient(fields, token)) as { Client?: { Id?: string | number } };
  if (created.Client?.Id === undefined) throw new Error("Mindbody AddClient returned no client id");
  return { clientId: String(created.Client.Id), linked: false };
}
