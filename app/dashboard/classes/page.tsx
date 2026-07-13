import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ClassOccurrenceRow = {
  id: string;
  mindbody_occurrence_id: number | null;
  class_name: string | null;
  instructor_name: string | null;
  start_datetime: string | null;
  max_capacity: number | null;
  total_booked: number | null;
  staff: { display_name: string } | null;
  department: { name: string | null } | null;
  room: { name: string | null } | null;
  organization: { timezone: string | null } | null;
};

async function getClassOccurrences() {
  // TODO(blocker before Sprint 3 / multi-tenant dashboard work): this uses the
  // service-role admin client, which bypasses Row Level Security entirely.
  // There are currently no RLS policies on class_occurrences (or its joined
  // tables), and the anon-key server client (lib/supabase/server.ts) returns
  // zero rows for everything -- confirmed empirically. Fine for a single-org
  // sandbox, but unsafe the moment a second organization exists: nothing
  // stops this query from returning every org's data. Needs either RLS
  // policies scoped by organization_id + a real authenticated (non-admin)
  // client, or equivalent app-level tenant scoping, before this goes near a
  // shared alpha.
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("class_occurrences")
    .select(
      `
      id,
      mindbody_occurrence_id,
      class_name,
      instructor_name,
      start_datetime,
      max_capacity,
      total_booked,
      staff:staff!class_occurrences_staff_id_fkey ( display_name ),
      department:departments!class_occurrences_department_id_fkey ( name ),
      room:rooms!class_occurrences_room_id_fkey ( name ),
      organization:organizations!class_occurrences_organization_id_fkey ( timezone )
      `,
    )
    // The pre-redesign rows never captured an occurrence id -- exclude them
    // rather than show stale/ambiguous data.
    .not("mindbody_occurrence_id", "is", null)
    .order("start_datetime", { ascending: true })
    .returns<ClassOccurrenceRow[]>();

  if (error) {
    throw new Error(`Failed to load class occurrences: ${error.message}`);
  }

  return data ?? [];
}

function getFillRate(totalBooked = 0, maxCapacity = 0) {
  if (maxCapacity <= 0) {
    return 0;
  }

  return Math.round((totalBooked / maxCapacity) * 100);
}

function formatStartTime(startDatetime: string | null, timezone: string | null) {
  if (!startDatetime) {
    return "N/A";
  }

  const zoned = DateTime.fromISO(startDatetime, { zone: "utc" }).setZone(
    timezone ?? "utc",
  );

  return zoned.toFormat("EEE, MMM d 'at' h:mm a ZZZZ");
}

export default async function ClassesPage() {
  const occurrences = await getClassOccurrences();

  return (
    <DashboardShell
      title="Classes"
      description="Live Mindbody class schedule data."
    >
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left">Occurrence ID</th>
              <th className="p-3 text-left">Class</th>
              <th className="p-3 text-left">Start Time</th>
              <th className="p-3 text-left">Instructor</th>
              <th className="p-3 text-left">Department</th>
              <th className="p-3 text-left">Room</th>
              <th className="p-3 text-right">Capacity</th>
              <th className="p-3 text-right">Booked</th>
              <th className="p-3 text-right">Fill Rate</th>
            </tr>
          </thead>
          <tbody>
            {occurrences.map((occurrence) => {
              const capacity = occurrence.max_capacity ?? 0;
              const booked = occurrence.total_booked ?? 0;
              const fillRate = getFillRate(booked, capacity);
              const instructor =
                occurrence.staff?.display_name ??
                occurrence.instructor_name ??
                "Unassigned";
              const department = occurrence.department?.name ?? "Not assigned";
              const room = occurrence.room?.name ?? "Not assigned";

              return (
                <tr key={occurrence.id} className="border-b">
                  <td className="p-3 font-mono text-xs text-zinc-500">
                    {occurrence.mindbody_occurrence_id}
                  </td>
                  <td className="p-3">{occurrence.class_name ?? "Unknown"}</td>
                  <td className="p-3">
                    {formatStartTime(
                      occurrence.start_datetime,
                      occurrence.organization?.timezone ?? null,
                    )}
                  </td>
                  <td className="p-3">{instructor}</td>
                  <td className="p-3">{department}</td>
                  <td className="p-3">{room}</td>
                  <td className="p-3 text-right">{capacity}</td>
                  <td className="p-3 text-right">{booked}</td>
                  <td className="p-3 text-right">{fillRate}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
