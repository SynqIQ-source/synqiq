import type { SupabaseClient } from "@supabase/supabase-js";

// Nightly auto-tagging of the Instructor and Trainer tags (lib/permissions.ts)
// from Mindbody data: anyone who taught or subbed a class in the last 180
// days is an Instructor; anyone with an appointment is a Trainer. Only ever
// turns a tag on, and skips anyone a club admin has set by hand
// (teaching_roles_set_at), so a removed tag stays removed.
const LOOKBACK_DAYS = 180;

export async function autoTagTeachingRoles(
  supabase: SupabaseClient,
  organizationId: string,
  kind: "instructor" | "trainer",
): Promise<void> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const column = kind === "instructor" ? "is_instructor" : "is_trainer";

  const { data: candidates, error } = await supabase
    .from("staff")
    .select("id")
    .eq("organization_id", organizationId)
    .eq(column, false)
    .is("teaching_roles_set_at", null)
    .is("archived_at", null);
  if (error) throw error;
  const ids = (candidates ?? []).map((row) => row.id as string);
  if (ids.length === 0) return;

  const found = new Set<string>();
  if (kind === "instructor") {
    for (const field of ["staff_id", "substitute_staff_id"] as const) {
      const { data, error: classError } = await supabase
        .from("class_occurrences")
        .select(field)
        .eq("organization_id", organizationId)
        .in(field, ids)
        .gte("start_datetime", since)
        .limit(5000);
      if (classError) throw classError;
      for (const row of data ?? []) found.add((row as Record<string, string>)[field]);
    }
  } else {
    const { data, error: apptError } = await supabase
      .from("appointment_occurrences")
      .select("staff_id")
      .eq("organization_id", organizationId)
      .in("staff_id", ids)
      .gte("start_datetime", since)
      .limit(5000);
    if (apptError) throw apptError;
    for (const row of data ?? []) found.add(row.staff_id as string);
  }

  if (found.size === 0) return;
  const { error: updateError } = await supabase
    .from("staff")
    .update({ [column]: true })
    .in("id", [...found])
    .is("teaching_roles_set_at", null);
  if (updateError) throw updateError;
}
