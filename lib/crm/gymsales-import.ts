import { normalizeEmail, normalizePhone } from "@/lib/crm/normalize";

// Gym Sales "People" export -> CRM guests. Pure; unit-tested in
// tests/gymsales-import.test.ts. Decisions (Adam, 2026-11-15): import
// everyone; leads without a salesperson stay unassigned; anyone who didn't
// opt out of texts/emails counts as opted in; trial_end_at and
// trial_days_quantity (columns O and P) are left out.

export type GymSalesRow = Record<string, string>;

export type ImportContext = {
  staffByName: Map<string, string>; // lower-case display name -> staff id
  // "firstname|email" / "firstname|phone" -> crm contact id (same person only:
  // families often share a phone or email).
  existingByEmail: Map<string, string>;
  existingByPhone: Map<string, string>;
  memberByEmail: Map<string, string>; // mindbody client id of a current member
  memberByPhone: Map<string, string>;
};

export type PlannedContact = {
  externalRef: string;
  existingId: string | null; // update this CRM guest instead of creating one
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  dateOfBirth: string | null;
  status: "lead" | "guest" | "member" | "not_interested";
  source: "walk_in" | "guest_of_member" | "phone_in" | "web" | "other";
  howHeard: string[];
  assignedStaffId: string | null;
  mindbodyClientId: string | null;
  smsConsent: boolean;
  smsOptedOutAt: string | null;
  emailConsent: boolean;
  createdAt: string | null;
  notInterestedAt: string | null;
  importData: Record<string, string | boolean | null>;
};

export type ImportPlan = {
  contacts: PlannedContact[];
  stats: {
    rows: number;
    create: number;
    updateExisting: number;
    duplicatesInFile: number;
    members: number;
    formerSales: number;
    notInterested: number;
    assigned: number;
    unassigned: number;
    unknownSalesperson: Record<string, number>;
    noEmailOrPhone: number;
    damagedPhones: number;
    smsOptedOut: number;
    emailOptedOut: number;
    byStatus: Record<string, number>;
  };
};

const SOURCE_BY_CONTACT: Record<string, PlannedContact["source"]> = {
  "walk in": "walk_in",
  internet: "web",
  "guest visit": "guest_of_member",
  "phone-in": "phone_in",
};

const clean = (value: string | undefined) => {
  const text = (value ?? "").trim();
  return text ? text : null;
};

// Gym Sales dates: "9/26/2026 19:37" or "9/26/2026" (studio time; stored as
// that wall time in UTC-agnostic ISO since the exact hour isn't critical).
export function gymSalesDate(value: string | undefined, withTime = true): string | null {
  const match = (value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, m, d, y, hh, mm] = match;
  const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (!withTime) return date;
  return `${date}T${(hh ?? "12").padStart(2, "0")}:${mm ?? "00"}:00-06:00`;
}

// Gym Sales exports phones as 11 digits ("18325551234"). A number that went
// through Excel ("1.83255e+10") lost digits and can't be used.
export function gymSalesPhone(value: string | undefined): { phone: string | null; damaged: boolean } {
  const raw = (value ?? "").trim();
  if (!raw) return { phone: null, damaged: false };
  if (/e\+/i.test(raw)) return { phone: null, damaged: true };
  const digits = raw.replace(/\D/g, "");
  return { phone: normalizePhone(digits.length === 11 && digits.startsWith("1") ? `+${digits}` : digits), damaged: false };
}

export function planGymSalesImport(rows: GymSalesRow[], context: ImportContext): ImportPlan {
  const stats: ImportPlan["stats"] = {
    rows: rows.length,
    create: 0,
    updateExisting: 0,
    duplicatesInFile: 0,
    members: 0,
    formerSales: 0,
    notInterested: 0,
    assigned: 0,
    unassigned: 0,
    unknownSalesperson: {},
    noEmailOrPhone: 0,
    damagedPhones: 0,
    smsOptedOut: 0,
    emailOptedOut: 0,
    byStatus: {},
  };
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();
  const contacts: PlannedContact[] = [];
  // Newest first, so a duplicate keeps the most recently updated record.
  const ordered = [...rows].sort((a, b) => (gymSalesDate(b.updated_at) ?? "").localeCompare(gymSalesDate(a.updated_at) ?? ""));
  for (const row of ordered) {
    const email = normalizeEmail(row.email);
    const mobile = gymSalesPhone(row.phone_mobile);
    const home = gymSalesPhone(row.phone_home);
    if (mobile.damaged || home.damaged) stats.damagedPhones += 1;
    const phone = mobile.phone ?? home.phone;
    // The same person twice = same first name and same email or phone.
    const first = (row.first_name ?? "").trim().toLowerCase();
    const emailKey = email ? `${first}|${email}` : null;
    const phoneKey = phone ? `${first}|${phone}` : null;
    if ((emailKey && seenEmail.has(emailKey)) || (phoneKey && seenPhone.has(phoneKey))) {
      stats.duplicatesInFile += 1;
      continue;
    }
    if (emailKey) seenEmail.add(emailKey);
    if (phoneKey) seenPhone.add(phoneKey);
    if (!email && !phone) stats.noEmailOrPhone += 1;

    const gsStatus = (row.status ?? "").trim().toLowerCase();
    const memberId =
      (email ? context.memberByEmail.get(email) : undefined) ?? (phone ? context.memberByPhone.get(phone) : undefined) ?? null;
    let status: PlannedContact["status"];
    if (memberId) status = "member";
    else if (gsStatus === "not_interested") status = "not_interested";
    else if (gsStatus === "guest") status = "guest";
    else status = "lead";
    if (status === "member") stats.members += 1;
    if (gsStatus === "sale" && !memberId) stats.formerSales += 1;
    if (status === "not_interested") stats.notInterested += 1;
    stats.byStatus[status] = (stats.byStatus[status] ?? 0) + 1;

    const salesperson = clean(row.salesperson);
    const assignedStaffId = salesperson ? (context.staffByName.get(salesperson.toLowerCase()) ?? null) : null;
    if (assignedStaffId) stats.assigned += 1;
    else {
      stats.unassigned += 1;
      if (salesperson) stats.unknownSalesperson[salesperson] = (stats.unknownSalesperson[salesperson] ?? 0) + 1;
    }

    const smsOptOut = (row.opted_out_of_sms ?? "").trim().toLowerCase() === "yes";
    const emailOptOut = (row.opted_out_of_email ?? "").trim().toLowerCase() === "yes";
    if (smsOptOut) stats.smsOptedOut += 1;
    if (emailOptOut) stats.emailOptedOut += 1;
    const updatedAt = gymSalesDate(row.updated_at);
    const existingId =
      (emailKey ? context.existingByEmail.get(emailKey) : undefined) ??
      (phoneKey ? context.existingByPhone.get(phoneKey) : undefined) ??
      null;
    if (existingId) stats.updateExisting += 1;
    else stats.create += 1;

    const contactWay = (row.contact ?? "").trim().toLowerCase();
    contacts.push({
      externalRef: `gymsales:${(row.id ?? "").trim()}`,
      existingId,
      firstName: clean(row.first_name) ?? "Unknown",
      lastName: clean(row.last_name) ?? "",
      email,
      phone,
      address: clean(row.address),
      city: clean(row.city),
      state: clean(row.state),
      postalCode: clean(row.zip),
      dateOfBirth: gymSalesDate(row.birthday, false),
      status,
      source: SOURCE_BY_CONTACT[contactWay] ?? (contactWay === "referral" ? "guest_of_member" : "other"),
      howHeard: clean(row.source) ? [clean(row.source) as string] : [],
      assignedStaffId,
      mindbodyClientId: memberId,
      smsConsent: !smsOptOut,
      smsOptedOutAt: smsOptOut ? (updatedAt ?? gymSalesDate(row.created_at)) : null,
      emailConsent: !emailOptOut,
      createdAt: gymSalesDate(row.created_at),
      notInterestedAt: status === "not_interested" ? (gymSalesDate(row.leaving_at) ?? updatedAt) : null,
      importData: {
        gymSalesId: clean(row.id),
        gymSalesStatus: clean(row.status),
        enquiryType: clean(row.contact),
        salesperson,
        createdBy: clean(row.created_by),
        saleAt: gymSalesDate(row.sale_at),
        leavingAt: gymSalesDate(row.leaving_at),
        leavingReason: clean(row.leaving_reason),
        firstContact: gymSalesDate(row.first_contact),
        tags: clean(row.tags),
        guestWaiverSigned: (row.guest_waiver_signed ?? "").trim().toLowerCase() === "yes",
        waiverSignedDate: gymSalesDate(row.waiver_signed_date, false),
        emailSource: clean(row.email_source),
        homePhone: home.phone,
      },
    });
  }
  return { contacts, stats };
}
