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
  other: "Other",
};

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
  hasOpenMatch: boolean;
  emailUndeliverable: boolean;
  referrerUnresolved: boolean;
  waiverSigned: boolean;
  assigned: boolean;
}): string {
  if (input.hasUnreadMessage) return "Reply to new message";
  if (input.hasOpenMatch) return "Resolve possible duplicate";
  if (input.emailUndeliverable) return "Fix email address";
  if (input.referrerUnresolved) return "Confirm referring member";
  if (!input.waiverSigned) return "Waiver needed";
  if (!input.assigned) return "Assign a salesperson";
  return "Follow up";
}
