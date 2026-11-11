import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Subs on SynqIQ's class calendar (class_sessions). A sub is a single-date
// instructor change stored in the session's `edits`, tagged with where it
// came from (`sub_source`):
//   "synqiq"   - approved through SynqIQ's sub requests (wins; never undone
//                by Mindbody data)
//   "mindbody" - set directly in Mindbody; follows Mindbody (removed if
//                Mindbody goes back to the regular instructor)
// A manual instructor change in the Calendar tab clears the tag and wins.

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Edits = Record<string, unknown>;

async function sessionFor(admin: Admin, organizationId: string, scheduleId: number | string | null, startsAt: string) {
  if (!scheduleId) return null;
  const { data } = await admin
    .from("class_sessions")
    .select("id, staff_mindbody_id, edits")
    .eq("organization_id", organizationId)
    .eq("mindbody_class_schedule_id", scheduleId)
    .eq("starts_at", startsAt)
    .maybeSingle();
  return data as { id: string; staff_mindbody_id: number | null; edits: Edits | null } | null;
}

async function setSub(
  admin: Admin,
  organizationId: string,
  session: { id: string; staff_mindbody_id: number | null; edits: Edits | null },
  subMindbodyId: number | null,
  source: "synqiq" | "mindbody",
  staffId: string | null,
) {
  const edits = { ...(session.edits ?? {}) };
  const previous = (edits.staff_mindbody_id as number | undefined) ?? session.staff_mindbody_id;
  const regular = session.staff_mindbody_id;
  if (subMindbodyId === null || subMindbodyId === regular) {
    // Back to the regular instructor.
    if (edits.sub_source !== source) return false;
    delete edits.staff_mindbody_id;
    delete edits.sub_source;
  } else {
    if (edits.staff_mindbody_id === subMindbodyId && edits.sub_source === source) return false;
    edits.staff_mindbody_id = subMindbodyId;
    edits.sub_source = source;
  }
  const { error } = await admin.from("class_sessions").update({ edits }).eq("id", session.id);
  if (error) throw new Error(error.message);
  await admin.from("catalog_edits").insert({
    organization_id: organizationId,
    entity: "class_session",
    row_id: session.id,
    changes: { staff_mindbody_id: { from: previous ?? null, to: edits.staff_mindbody_id ?? regular ?? null } },
    edited_by_staff_id: staffId,
    note: source === "synqiq" ? "Sub approved via sub request" : "Sub set in Mindbody",
  });
  return true;
}

// Right after a sub request is approved in SynqIQ.
export async function applyApprovedSub(occurrenceId: string, subStaffId: string, approvedByStaffId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const [{ data: occurrence }, { data: sub }] = await Promise.all([
    admin
      .from("class_occurrences")
      .select("organization_id, mindbody_class_schedule_id, start_datetime")
      .eq("id", occurrenceId)
      .maybeSingle(),
    admin.from("staff").select("mindbody_staff_id").eq("id", subStaffId).maybeSingle(),
  ]);
  if (!occurrence || !sub?.mindbody_staff_id) return false;
  const session = await sessionFor(
    admin,
    occurrence.organization_id as string,
    occurrence.mindbody_class_schedule_id as number,
    occurrence.start_datetime as string,
  );
  if (!session) return false;
  return setSub(admin, occurrence.organization_id as string, session, Number(sub.mindbody_staff_id), "synqiq", approvedByStaffId);
}

// After each calendar build: SynqIQ-approved subs for upcoming classes, and
// subs made directly in Mindbody (from its class sync).
export async function syncSubsIntoCalendar(
  organizationId: string,
  fromIso: string,
  toIso: string,
): Promise<{ synqiq: number; mindbody: number }> {
  const admin = createSupabaseAdminClient();
  const counts = { synqiq: 0, mindbody: 0 };
  const { data: staffRows } = await admin.from("staff").select("id, mindbody_staff_id").eq("organization_id", organizationId);
  const mindbodyIdOf = new Map(
    (staffRows ?? []).map((row) => [row.id as string, row.mindbody_staff_id === null ? null : Number(row.mindbody_staff_id)]),
  );

  const { data: occurrences } = await admin
    .from("class_occurrences")
    .select("id, mindbody_class_schedule_id, start_datetime, staff_id, substitute_staff_id")
    .eq("organization_id", organizationId)
    .gte("start_datetime", fromIso)
    .lte("start_datetime", toIso)
    .limit(5000);
  if (!occurrences?.length) return counts;

  const { data: sessions } = await admin
    .from("class_sessions")
    .select("id, mindbody_class_schedule_id, starts_at, staff_mindbody_id, edits")
    .eq("organization_id", organizationId)
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .not("mindbody_class_schedule_id", "is", null)
    .limit(5000);
  const sessionByKey = new Map(
    (sessions ?? []).map((row) => [
      `${row.mindbody_class_schedule_id}|${Date.parse(row.starts_at as string)}`,
      row as { id: string; staff_mindbody_id: number | null; edits: Edits | null },
    ]),
  );

  for (const occurrence of occurrences) {
    const session = sessionByKey.get(`${occurrence.mindbody_class_schedule_id}|${Date.parse(occurrence.start_datetime as string)}`);
    if (!session) continue;
    const edits = session.edits ?? {};
    const manual = "staff_mindbody_id" in edits && !edits.sub_source;
    if (manual) continue; // a manual change in SynqIQ wins
    if (occurrence.substitute_staff_id) {
      const sub = mindbodyIdOf.get(occurrence.substitute_staff_id as string) ?? null;
      if (sub !== null && (await setSub(admin, organizationId, session, sub, "synqiq", null))) counts.synqiq += 1;
      continue;
    }
    if (edits.sub_source === "synqiq") continue;
    const mindbodyTeacher = occurrence.staff_id ? (mindbodyIdOf.get(occurrence.staff_id as string) ?? null) : null;
    if (mindbodyTeacher === null) continue;
    if (await setSub(admin, organizationId, session, mindbodyTeacher, "mindbody", null)) counts.mindbody += 1;
  }
  return counts;
}
