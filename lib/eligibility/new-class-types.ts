import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOptionalEnv } from "@/lib/env";
import { isExcludedDepartmentName } from "@/lib/excluded-departments";
import { isJunkClassName } from "@/lib/excluded-class-names";
import { sendEmailToRecipients } from "@/lib/email/send";
import { newClassTypesEmail } from "@/lib/email/templates";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type NewClassType = {
  departmentId: string;
  departmentName: string;
  className: string;
  seededStaffNames: string[];
};

// Same lookback the original eligibility seed used (see
// 20260715180000_substitution_workflow.sql), plus every already-scheduled
// future occurrence -- a brand-new format is usually on the schedule before
// it has much (or any) teaching history.
const LOOKBACK_DAYS = 90;
const PAGE_SIZE = 1000;

// instructor_class_eligibility was seeded exactly once, from history, so any
// class type introduced after that (e.g. "Beat" in Membership GX Classes)
// had no eligible instructors at all -- a sub request for it notified no
// one. This closes that gap on every sync: a (department, class_name) combo
// with ZERO eligibility rows is a new class type, and the instructors
// actually assigned to teach it become eligible.
//
// Only ever touches combos with no rows at all. Once a combo has any row
// (seeded here, by the original seed, or toggled by an admin), this never
// adds, re-enables, or overrides anything for it -- the Class Eligibility
// page stays the source of truth after first contact.
export async function seedEligibilityForNewClassTypes(
  supabase: SupabaseAdminClient,
  organizationId: string,
  options: { notifyAdmins: boolean } = { notifyAdmins: true },
): Promise<NewClassType[]> {
  const { data: departments, error: departmentsError } = await supabase
    .from("departments")
    .select("id, name")
    .eq("organization_id", organizationId);

  if (departmentsError) {
    throw new Error(`Failed to load departments: ${departmentsError.message}`);
  }

  const departmentNameById = new Map(
    (departments ?? [])
      .filter((department) => !isExcludedDepartmentName(department.name))
      .map((department) => [department.id, department.name as string]),
  );

  if (departmentNameById.size === 0) {
    return [];
  }

  const departmentIds = [...departmentNameById.keys()];
  const comboKey = (departmentId: string, className: string) => `${departmentId}\u0000${className}`;

  // Paged -- Supabase caps an unranged select at 1000 rows, and a single busy
  // department alone already exceeds that.
  const existingCombos = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("instructor_class_eligibility")
      .select("department_id, class_name")
      .in("department_id", departmentIds)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load eligibility: ${error.message}`);
    }
    for (const row of data) {
      existingCombos.add(comboKey(row.department_id, row.class_name));
    }
    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  const since = DateTime.utc().minus({ days: LOOKBACK_DAYS }).toISO();
  const staffIdsByNewCombo = new Map<string, { departmentId: string; className: string; staffIds: Set<string> }>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("class_occurrences")
      .select("department_id, class_name, staff_id")
      .eq("organization_id", organizationId)
      .in("department_id", departmentIds)
      .gte("start_datetime", since)
      .not("class_name", "is", null)
      .not("staff_id", "is", null)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load class occurrences: ${error.message}`);
    }

    for (const row of data) {
      // Trimmed, matching how eligibility rows are stored and looked up
      // (POST /api/instructor-eligibility and substitution request creation
      // both .trim() the class name).
      const className = (row.class_name as string).trim();
      if (isJunkClassName(className)) {
        continue;
      }
      const key = comboKey(row.department_id, className);
      if (existingCombos.has(key)) {
        continue;
      }
      const entry = staffIdsByNewCombo.get(key) ?? {
        departmentId: row.department_id,
        className,
        staffIds: new Set<string>(),
      };
      entry.staffIds.add(row.staff_id);
      staffIdsByNewCombo.set(key, entry);
    }

    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  if (staffIdsByNewCombo.size === 0) {
    return [];
  }

  // Only current staff -- same filter the Class Eligibility page applies.
  const allStaffIds = [...new Set([...staffIdsByNewCombo.values()].flatMap((entry) => [...entry.staffIds]))];
  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .select("id, display_name")
    .in("id", allStaffIds)
    .eq("active", true)
    .is("archived_at", null);

  if (staffError) {
    throw new Error(`Failed to load staff: ${staffError.message}`);
  }

  const staffNameById = new Map((staff ?? []).map((member) => [member.id, member.display_name as string]));
  const now = new Date().toISOString();
  const newClassTypes: NewClassType[] = [];
  const rows = [];

  for (const entry of staffIdsByNewCombo.values()) {
    const currentStaffIds = [...entry.staffIds].filter((staffId) => staffNameById.has(staffId));
    if (currentStaffIds.length === 0) {
      continue;
    }
    for (const staffId of currentStaffIds) {
      rows.push({
        staff_id: staffId,
        department_id: entry.departmentId,
        class_name: entry.className,
        enabled: true,
        updated_by: null,
        updated_at: now,
      });
    }
    newClassTypes.push({
      departmentId: entry.departmentId,
      departmentName: departmentNameById.get(entry.departmentId) ?? "Unknown department",
      className: entry.className,
      seededStaffNames: currentStaffIds.map((staffId) => staffNameById.get(staffId) as string).sort(),
    });
  }

  if (rows.length === 0) {
    return [];
  }

  // ignoreDuplicates -> ON CONFLICT DO NOTHING: never overwrites a row an
  // admin may have created between the read above and this write.
  const { error: insertError } = await supabase
    .from("instructor_class_eligibility")
    .upsert(rows, { onConflict: "staff_id,department_id,class_name", ignoreDuplicates: true });

  if (insertError) {
    throw new Error(`Failed to seed eligibility: ${insertError.message}`);
  }

  if (options.notifyAdmins) {
    await notifyAdminsOfNewClassTypes(supabase, organizationId, newClassTypes);
  }

  return newClassTypes;
}

// Best-effort, never throws -- a failed email must not fail the sync.
async function notifyAdminsOfNewClassTypes(
  supabase: SupabaseAdminClient,
  organizationId: string,
  newClassTypes: NewClassType[],
): Promise<void> {
  try {
    const { data: admins, error } = await supabase
      .from("staff")
      .select("display_name, email")
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .is("archived_at", null)
      .not("email", "is", null);

    if (error) {
      throw new Error(error.message);
    }

    const siteUrl = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? "https://synqiq.co";
    const { subject, html } = newClassTypesEmail({ newClassTypes, siteUrl });

    await sendEmailToRecipients(
      (admins ?? [])
        .filter((admin): admin is typeof admin & { email: string } => Boolean(admin.email))
        .map((admin) => ({ email: admin.email, displayName: admin.display_name })),
      { subject, html },
    );
  } catch (error) {
    console.error(
      "[seedEligibilityForNewClassTypes] Failed to email admins:",
      error instanceof Error ? error.message : error,
    );
  }
}
