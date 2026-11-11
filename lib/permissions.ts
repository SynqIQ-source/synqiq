// Who can do what -- the one place the role matrix lives. Pages, API routes
// and the nav all ask these questions instead of checking role strings.
//
//   Club Admin (role "admin")  everything in their studio: settings, staff and
//                              roles, sub approvals, every dashboard.
//   Sales Lead                 every guest and lead, reassign, mark sold, every
//                              salesperson's dashboard. No staff management.
//   Sales                      only the guests/leads assigned to them, and their
//                              own sales numbers.
//   Staff                      no management or sales access on its own.
//
//   Instructor tag             Overview (no pay figures), the Teaching pages,
//                              class follow-ups.
//   Trainer tag                New Members (their own members), Trainer Health,
//                              new-member follow-ups.
//
// Tags combine with any role and with each other. SynqIQ super admins are in
// platform_admins (lib/platform/admin.ts) and are Club Admins of their own
// studio.

export const STAFF_ROLES = ["admin", "sales_lead", "sales", "staff"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Club Admin",
  sales_lead: "Sales Lead",
  sales: "Sales",
  staff: "Staff",
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

type Who = { role: StaffRole; canSell: boolean; isInstructor: boolean; isTrainer: boolean };

export const isClubAdmin = (staff: Who) => staff.role === "admin";

// Every guest and lead, reassigning, every salesperson's numbers.
export const managesSales = (staff: Who) => staff.role === "admin" || staff.role === "sales_lead";

// Any CRM access at all (Sales pages, Guests).
export const canUseCrm = (staff: Who) => managesSales(staff) || staff.role === "sales" || staff.canSell;

// Limited to their own assigned guests and their own numbers.
export const seesOnlyOwnSales = (staff: Who) => canUseCrm(staff) && !managesSales(staff);

export const isInstructorAccess = (staff: Who) => isClubAdmin(staff) || staff.isInstructor;
export const isTrainerAccess = (staff: Who) => isClubAdmin(staff) || staff.isTrainer;

// Front-desk check-in: sales staff (the front desk today), Club Admins and
// trainers. Instructor-only staff don't check people in.
export const canCheckIn = (staff: Who) => canUseCrm(staff) || isClubAdmin(staff) || staff.isTrainer;

// Checkout (POS): Club Admins, Sales Leads, Sales, trainers and front-desk
// staff. Instructor-only staff (Staff role, Instructor tag, no Trainer tag)
// don't ring up sales.
export const canCheckout = (staff: Who) => staff.role !== "staff" || staff.isTrainer || staff.canSell || !staff.isInstructor;
// Manual discounts at checkout: Sales and up. Trainers never (unless they
// also hold a Sales role).
export const canDiscountAtCheckout = (staff: Who) => staff.role === "admin" || staff.role === "sales_lead" || staff.role === "sales";

export const canViewOverview = (staff: Who) => isClubAdmin(staff) || staff.isInstructor;
// Instructor pay / cost figures from payroll imports.
export const canViewPay = (staff: Who) => isClubAdmin(staff);

// Sub requests: volunteers' email addresses are shown only to Club Admins
// and the instructor who asked for the sub.
export const canSeeVolunteerEmails = (staff: Who & { id: string }, requestedByStaffId: string | null) =>
  isClubAdmin(staff) || staff.id === requestedByStaffId;

// Where someone lands when a page isn't theirs (and after sign-in).
export function homePath(staff: Who): string {
  if (canViewOverview(staff)) return "/dashboard";
  if (canUseCrm(staff)) return "/dashboard/sales";
  if (staff.isTrainer) return "/dashboard/sales/new-members";
  return "/dashboard/messages";
}
