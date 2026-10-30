// Display labels for CRM enum values.

export const VISIT_TYPE_LABELS: Record<string, string> = {
  appointment: "Appointment",
  trial_visit: "Trial Visit",
  walk_in: "Walk In",
  guest_visit: "Guest Visit",
};

export const SOURCE_LABELS: Record<string, string> = {
  walk_in: "Walk In",
  guest_of_member: "Guest of Member",
  phone_in: "Phone In",
  web: "Web",
  other: "Other",
  member: "Joined as a member",
};

// How someone became a lead, for the Sales dashboard's "Lead type" filter.
// Derived from the contact's source plus its referring member: a guest of a
// member is always "guest_of_member"; anyone else with a referring member is
// a "referral"; everyone else is their source.
export const LEAD_TYPES = [
  { value: "walk_in", label: "Walk-in" },
  { value: "guest_of_member", label: "Guest of member" },
  { value: "referral", label: "Referral" },
  { value: "phone_in", label: "Phone-in" },
  { value: "web", label: "Web lead" },
  { value: "other", label: "Other" },
] as const;
export type LeadType = (typeof LEAD_TYPES)[number]["value"];

// Short tags shown next to a guest's name (calendar, drill-downs).
export const LEAD_TYPE_TAGS: Record<LeadType, string> = {
  walk_in: "WI",
  guest_of_member: "GM",
  referral: "REF",
  phone_in: "PH",
  web: "WEB",
  other: "OTH",
};

// How an appointment turned out, for its color: blue = scheduled (not yet
// marked), grey = no-show, red = showed but hasn't bought, green = showed
// and bought.
export type AppointmentOutcome = "scheduled" | "no_show" | "showed" | "closed" | "canceled";

export function appointmentOutcome(status: string, contactClosedAt: string | null): AppointmentOutcome {
  if (status === "showed") return contactClosedAt ? "closed" : "showed";
  if (status === "no_show" || status === "canceled") return status;
  return "scheduled";
}

export const APPOINTMENT_OUTCOME_LABELS: Record<AppointmentOutcome, string> = {
  scheduled: "Scheduled",
  no_show: "No-show",
  showed: "Showed, not sold",
  closed: "Showed and sold",
  canceled: "Canceled",
};

export function isLeadType(value: unknown): value is LeadType {
  return LEAD_TYPES.some((type) => type.value === value);
}

export function leadTypeOf(contact: {
  source: string;
  referring_client_id: string | null;
  referrer_name_typed: string | null;
}): LeadType {
  if (contact.source === "guest_of_member") return "guest_of_member";
  if (contact.referring_client_id || contact.referrer_name_typed?.trim()) return "referral";
  return isLeadType(contact.source) ? contact.source : "other";
}

export const STATUS_LABELS: Record<string, string> = {
  guest: "Guest",
  lead: "Lead",
  member: "Member",
  not_interested: "Not interested",
};

export const MATCH_REASON_LABELS: Record<string, string> = {
  partial_match: "Email or phone matches an existing contact",
  name_mismatch: "Email and phone match, but the name is different",
  declined_match: "Guest said the matching contact wasn't them",
};

export const MINDBODY_SYNC_LABELS: Record<string, string> = {
  not_synced: "Not sent yet",
  pending: "Sending",
  synced: "In Mindbody",
  failed: "Failed",
  member_review: "Existing member, review",
};

export const EMAIL_CHECK_LABELS: Record<string, string> = {
  pending: "Not checked yet",
  deliverable: "Deliverable",
  undeliverable: "Undeliverable",
  risky: "Risky",
  unknown: "Unknown",
  skipped: "Skipped",
};

// The single most useful thing for staff to do next with a guest.
export function nextAction(input: {
  hasUnreadMessage?: boolean;
  enrolled?: boolean;
  hasOpenMatch: boolean;
  emailUndeliverable: boolean;
  referrerUnresolved: boolean;
  waiverSigned: boolean;
  assigned: boolean;
}): string {
  if (input.hasUnreadMessage) return "Reply to new message";
  if (input.enrolled) return "Enrolled";
  if (input.hasOpenMatch) return "Resolve possible duplicate";
  if (input.emailUndeliverable) return "Fix email address";
  if (input.referrerUnresolved) return "Confirm referring member";
  if (!input.waiverSigned) return "Waiver needed";
  if (!input.assigned) return "Assign a salesperson";
  return "Follow up";
}
