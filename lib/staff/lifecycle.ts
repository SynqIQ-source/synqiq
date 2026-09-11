import type { CurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type TargetStaff = {
  id: string;
  organization_id: string;
  display_name: string;
  role: "admin" | "instructor";
  auth_user_id: string | null;
  mindbody_staff_id: number | null;
  archived_at: string | null;
};

export type GuardResult =
  | { ok: true; target: TargetStaff }
  | { ok: false; status: number; error: string };

// Shared preconditions for archive / restore / delete: the caller is an
// admin, the target is in the caller's org, and the caller isn't acting on
// their own account. Admin client throughout -- `staff` has a SELECT RLS
// policy but no write policy, so this role check is the real gate (same as
// the invite / role / reset-password routes).
export async function loadManageableStaff(
  admin: Admin,
  currentStaff: CurrentStaff | null,
  staffId: string,
): Promise<GuardResult> {
  if (!currentStaff || currentStaff.role !== "admin") {
    return { ok: false, status: 403, error: "Only an authenticated admin can manage staff." };
  }

  const { data: target } = await admin
    .from("staff")
    .select("id, organization_id, display_name, role, auth_user_id, mindbody_staff_id, archived_at")
    .eq("id", staffId)
    .maybeSingle<TargetStaff>();

  if (!target || target.organization_id !== currentStaff.organizationId) {
    return { ok: false, status: 404, error: "Staff member not found." };
  }

  if (target.id === currentStaff.id) {
    return { ok: false, status: 400, error: "You can't do this to your own account." };
  }

  return { ok: true, target };
}

// Archiving or deleting the last non-archived admin would lock every admin
// page (this one included) behind a role only an admin can grant. Same
// guard the role route applies to demotion.
export async function wouldOrphanAdmins(
  admin: Admin,
  organizationId: string,
  target: TargetStaff,
): Promise<boolean> {
  if (target.role !== "admin") {
    return false;
  }

  const { count } = await admin
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .is("archived_at", null);

  return (count ?? 0) <= 1;
}

// Best-effort removal of a staff member's SynqIQ login. Both archive and
// delete call this -- a former employee shouldn't keep a working sign-in.
// Never throws: a missing/already-deleted auth user must not block the
// archive/delete it's part of.
export async function revokeStaffLogin(admin: Admin, authUserId: string | null): Promise<void> {
  if (!authUserId) {
    return;
  }
  try {
    await admin.auth.admin.deleteUser(authUserId);
  } catch (error) {
    console.error(
      `[staff-lifecycle] could not delete auth user ${authUserId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

// Every table with a staff FK. A DELETE only goes through when the row is
// referenced by NONE of these -- the mis-imported-front-desk case. Anything
// else (a real instructor with class or payroll history) is told to
// archive instead. This is a friendly pre-check; the FK constraints are
// still the real enforcement.
const STAFF_REFERENCES: { table: string; columns: string[]; label: string }[] = [
  { table: "class_occurrences", columns: ["staff_id", "substitute_staff_id"], label: "classes" },
  { table: "substitution_requests", columns: ["requested_by"], label: "substitution requests" },
  { table: "substitution_interests", columns: ["staff_id"], label: "substitution interests" },
  { table: "instructor_class_eligibility", columns: ["staff_id", "updated_by"], label: "class eligibility" },
  { table: "report_imports", columns: ["uploaded_by_staff_id"], label: "report imports" },
  { table: "instructor_reviews", columns: ["staff_id"], label: "instructor reviews" },
  { table: "revenue_line_items", columns: ["staff_id"], label: "revenue records" },
  { table: "payroll_line_items", columns: ["staff_id"], label: "payroll records" },
  { table: "appointment_occurrences", columns: ["staff_id"], label: "appointments" },
  { table: "sales", columns: ["sales_rep_staff_id"], label: "sales records" },
  { table: "board_members", columns: ["staff_id"], label: "message board membership" },
  { table: "board_messages", columns: ["author_staff_id"], label: "message board posts" },
  { table: "message_boards", columns: ["updated_by"], label: "message board edits" },
  { table: "followup_conversations", columns: ["instructor_id"], label: "follow-up conversations" },
  { table: "push_subscriptions", columns: ["staff_id"], label: "device notifications" },
];

export async function findStaffReferences(admin: Admin, staffId: string): Promise<string[]> {
  const labels: string[] = [];

  for (const ref of STAFF_REFERENCES) {
    const orClause = ref.columns.map((column) => `${column}.eq.${staffId}`).join(",");
    const { count, error } = await admin
      .from(ref.table)
      .select("id", { count: "exact", head: true })
      .or(orClause);

    if (error) {
      // "Can't tell" -> don't block here; the FK constraint on the DELETE
      // itself will still refuse an unsafe removal.
      console.error(`[staff-lifecycle] reference check failed for ${ref.table}: ${error.message}`);
      continue;
    }

    if ((count ?? 0) > 0) {
      labels.push(ref.label);
    }
  }

  return labels;
}
