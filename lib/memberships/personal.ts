import { toDate } from "@/lib/memberships/contracts";

// Members' personal information: Mindbody's copy plus SynqIQ edits, which
// win (member_personal). Pure, unit-tested in tests/member-personal.test.ts.

export type MindbodyClientRecord = {
  Id?: string | null;
  FirstName?: string | null;
  LastName?: string | null;
  Email?: string | null;
  MobilePhone?: string | null;
  HomePhone?: string | null;
  AddressLine1?: string | null;
  AddressLine2?: string | null;
  City?: string | null;
  State?: string | null;
  PostalCode?: string | null;
  BirthDate?: string | null;
  PhotoUrl?: string | null;
  EmergencyContactInfoName?: string | null;
  EmergencyContactInfoPhone?: string | null;
};

export const PERSONAL_FIELDS = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  mobilePhone: "Mobile phone",
  homePhone: "Home phone",
  birthDate: "Birthday",
  addressLine1: "Address",
  addressLine2: "Address line 2",
  city: "City",
  state: "State",
  postalCode: "ZIP",
  emergencyContactName: "Emergency contact",
  emergencyContactPhone: "Emergency contact phone",
} as const;
export type PersonalField = keyof typeof PERSONAL_FIELDS;
export type MemberPersonal = Record<PersonalField, string | null> & { photoUrl: string | null };

const text = (value: string | null | undefined) => (typeof value === "string" && value.trim() ? value.trim() : null);

export function toPersonal(client: MindbodyClientRecord | null | undefined): MemberPersonal {
  const birth = toDate(client?.BirthDate);
  return {
    firstName: text(client?.FirstName),
    lastName: text(client?.LastName),
    email: text(client?.Email),
    mobilePhone: text(client?.MobilePhone),
    homePhone: text(client?.HomePhone),
    addressLine1: text(client?.AddressLine1),
    addressLine2: text(client?.AddressLine2),
    city: text(client?.City),
    state: text(client?.State),
    postalCode: text(client?.PostalCode),
    birthDate: birth && birth !== "0001-01-01" ? birth : null,
    photoUrl: text(client?.PhotoUrl),
    emergencyContactName: text(client?.EmergencyContactInfoName),
    emergencyContactPhone: text(client?.EmergencyContactInfoPhone),
  };
}

// What to show: SynqIQ edits over Mindbody's copy (an edit to empty clears
// the field).
export function mergePersonal(
  mindbody: Partial<MemberPersonal> | null | undefined,
  edits: Partial<Record<PersonalField, string | null>> | null | undefined,
): MemberPersonal & { edited: PersonalField[] } {
  const merged = { photoUrl: mindbody?.photoUrl ?? null } as MemberPersonal & { edited: PersonalField[] };
  merged.edited = [];
  for (const field of Object.keys(PERSONAL_FIELDS) as PersonalField[]) {
    if (edits && Object.prototype.hasOwnProperty.call(edits, field)) {
      merged[field] = edits[field] ?? null;
      merged.edited.push(field);
    } else {
      merged[field] = mindbody?.[field] ?? null;
    }
  }
  return merged;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Checks a form submission against what's shown now; returns only the
// fields that changed (trimmed; "" -> null).
export function validatePersonalEdit(
  input: unknown,
  current: MemberPersonal,
  today: string,
): { ok: true; changes: Partial<Record<PersonalField, { from: string | null; to: string | null }>> } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to save." };
  const raw = input as Record<string, unknown>;
  const changes: Partial<Record<PersonalField, { from: string | null; to: string | null }>> = {};
  for (const field of Object.keys(PERSONAL_FIELDS) as PersonalField[]) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (value !== null && typeof value !== "string") return { ok: false, error: `${PERSONAL_FIELDS[field]} isn't valid.` };
    const next = typeof value === "string" && value.trim() ? value.trim() : null;
    if (next && next.length > 200) return { ok: false, error: `${PERSONAL_FIELDS[field]} is too long.` };
    if ((field === "firstName" || field === "lastName") && !next) return { ok: false, error: `${PERSONAL_FIELDS[field]} can't be empty.` };
    if (field === "email" && next && !EMAIL.test(next)) return { ok: false, error: "Enter a valid email." };
    if (field === "birthDate" && next && (!DATE.test(next) || next > today || next < "1900-01-01")) {
      return { ok: false, error: "Enter a valid birthday." };
    }
    if (
      (field === "mobilePhone" || field === "homePhone" || field === "emergencyContactPhone") &&
      next &&
      next.replace(/\D/g, "").length < 7
    ) {
      return { ok: false, error: `${PERSONAL_FIELDS[field]} needs at least 7 digits.` };
    }
    if (next !== current[field]) changes[field] = { from: current[field], to: next };
  }
  return { ok: true, changes };
}
