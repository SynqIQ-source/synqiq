import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

// Departments hidden from reporting/analytics and substitution coverage
// app-wide, except Heat Map (which exists specifically to show utilization
// across every room/department, Pool Lanes included) and an instructor's own
// My Schedule (hiding someone's own assigned shift from their own agenda
// would be a functional regression, not a reporting preference).
export const EXCLUDED_DEPARTMENT_NAMES: readonly string[] = ["Pool Lanes"];

export function isExcludedDepartmentName(name: string | null | undefined): boolean {
  return name != null && EXCLUDED_DEPARTMENT_NAMES.includes(name);
}

export function excludedDepartmentIds(departments: { id: string; name: string }[]): Set<string> {
  return new Set(
    departments.filter((department) => isExcludedDepartmentName(department.name)).map((department) => department.id),
  );
}

// For callers that only need the id set, not a full departments list they'd
// otherwise have to fetch (and already aren't) -- one extra small query
// (a handful of rows, matched by name) rather than pulling every department
// just to filter three of them out.
export async function getExcludedDepartmentIds(supabase: ScopedSupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from("departments").select("id").in("name", EXCLUDED_DEPARTMENT_NAMES);

  if (error) {
    throw new Error(`Failed to resolve excluded departments: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.id));
}
