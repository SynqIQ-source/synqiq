import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { isExcludedDepartmentName } from "@/lib/excluded-departments";
import { EligibilityTable, type DepartmentRow } from "./eligibility-table";

export default async function EligibilitySettingsPage() {
  const currentStaff = await getCurrentStaff();

  // Real page-level guard, same as /dashboard/settings and
  // /dashboard/settings/staff -- this page triggers real writes, not just a
  // read view.
  if (!currentStaff || currentStaff.role !== "admin") {
    redirect("/dashboard");
  }

  const supabase = await getScopedClient(currentStaff);
  const { data: departments, error } = await supabase
    .from("departments")
    .select("id, name")
    .order("name")
    .returns<DepartmentRow[]>();

  if (error) {
    throw new Error(`Failed to load departments: ${error.message}`);
  }

  // Pool Lanes doesn't use the substitution system at all -- see
  // lib/excluded-departments.ts. Configuring eligibility for it would be
  // pointless: a request for it can never be created in the first place.
  const eligibleDepartments = (departments ?? []).filter(
    (department) => !isExcludedDepartmentName(department.name),
  );

  // Read-only, admin-visibility only -- instructors set this themselves
  // from /dashboard/notifications; there's no admin-side toggle here on
  // purpose, matching how push notification enablement is also entirely
  // self-service.
  // Not filtered by role -- eligibility itself is role-agnostic
  // (instructor_class_eligibility has no role check, and an admin-role
  // staff member can be a real teaching instructor too, e.g. a studio
  // owner who also teaches), so this list has to be too, or an opted-out
  // admin-instructor would silently vanish from it.
  const { data: instructors, error: instructorsError } = await supabase
    .from("staff")
    .select("id, display_name, substitution_reminder_opt_out")
    .eq("active", true)
    .order("display_name")
    .returns<{ id: string; display_name: string; substitution_reminder_opt_out: boolean }[]>();

  if (instructorsError) {
    throw new Error(`Failed to load instructors: ${instructorsError.message}`);
  }

  const optedOut = (instructors ?? []).filter((instructor) => instructor.substitution_reminder_opt_out);

  return (
    <DashboardShell
      title="Class Eligibility"
      description="Choose which instructors get pinged when a class in a given department needs a substitute. A class with no eligible instructors notifies no one."
    >
      <EligibilityTable departments={eligibleDepartments} />

      <section className="mt-8">
        <h2 className="text-base font-semibold text-zinc-950">Opted out of reminder emails</h2>
        <p className="mt-1 text-sm text-zinc-500">
          These instructors still get the immediate email when a request opens, but have turned off
          the every-4-days reminder for requests they haven&apos;t responded to yet. Set by each
          instructor from their own Notifications page -- not editable here.
        </p>

        {optedOut.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No one has opted out.</p>
        ) : (
          <ul className="mt-3 max-w-md divide-y rounded-lg border border-zinc-200 bg-white text-sm">
            {optedOut.map((instructor) => (
              <li key={instructor.id} className="p-3 text-zinc-950">
                {instructor.display_name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </DashboardShell>
  );
}
