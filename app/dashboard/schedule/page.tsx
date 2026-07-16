import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { StaffSelect } from "@/components/staff-select";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getActiveStaff } from "@/lib/staff";
import { DateNav } from "./date-nav";
import { SubRequestButton } from "./sub-request-button";

type ScheduleOccurrenceRow = {
  id: string;
  class_name: string | null;
  start_datetime: string | null;
  staff: { display_name: string } | null;
  department: { name: string | null } | null;
  room: { name: string | null } | null;
};

async function getOrgTimezone() {
  // Single-org sandbox today (see app/api/sync/classes/route.ts) -- one row,
  // upserted by mindbody_site_id. Same simplification as the rest of the app.
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("organizations")
    .select("timezone")
    .limit(1)
    .maybeSingle();

  return data?.timezone ?? "utc";
}

async function getScheduleForStaffOnDate(
  staffId: string,
  date: string,
  timezone: string,
) {
  const supabase = createSupabaseAdminClient();

  const dayStart = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });

  const { data, error } = await supabase
    .from("class_occurrences")
    .select(
      `
      id,
      class_name,
      start_datetime,
      staff:staff!class_occurrences_staff_id_fkey ( display_name ),
      department:departments!class_occurrences_department_id_fkey ( name ),
      room:rooms!class_occurrences_room_id_fkey ( name )
      `,
    )
    .eq("staff_id", staffId)
    .not("mindbody_occurrence_id", "is", null)
    .gte("start_datetime", dayStart.toUTC().toISO())
    .lt("start_datetime", dayEnd.toUTC().toISO())
    .order("start_datetime", { ascending: true })
    .returns<ScheduleOccurrenceRow[]>();

  if (error) {
    throw new Error(`Failed to load schedule: ${error.message}`);
  }

  return data ?? [];
}

function formatStartTime(startDatetime: string | null, timezone: string) {
  if (!startDatetime) {
    return "N/A";
  }

  return DateTime.fromISO(startDatetime, { zone: "utc" })
    .setZone(timezone)
    .toFormat("h:mm a ZZZZ");
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; staffId?: string }>;
}) {
  const params = await searchParams;
  const timezone = await getOrgTimezone();

  const date =
    params.date ?? DateTime.now().setZone(timezone).toISODate() ?? "";
  const staffId = params.staffId ?? null;

  const staffOptions = await getActiveStaff();
  const occurrences = staffId
    ? await getScheduleForStaffOnDate(staffId, date, timezone)
    : [];

  return (
    <DashboardShell
      title="My Schedule"
      description="Your own class schedule, day by day -- request a substitute directly from a class card."
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <StaffSelect staffOptions={staffOptions} staffId={staffId} />
        <DateNav date={date} />
      </div>

      <div className="mt-6">
        {!staffId ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-base font-semibold text-zinc-950">
              Select your name
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Choose your name above to view your classes for the selected
              date.
            </p>
          </section>
        ) : occurrences.length === 0 ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-base font-semibold text-zinc-950">
              No classes scheduled
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              You have no classes on{" "}
              {DateTime.fromISO(date).toFormat("EEE, MMM d")}.
            </p>
          </section>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {occurrences.map((occurrence) => {
              const className = occurrence.class_name ?? "Unknown class";
              const startFormatted = formatStartTime(
                occurrence.start_datetime,
                timezone,
              );
              const roomName = occurrence.room?.name ?? "Not assigned";
              const staffDisplayName = occurrence.staff?.display_name ?? "";

              return (
                <div
                  key={occurrence.id}
                  className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-white p-5"
                >
                  <div>
                    <h3 className="text-base font-semibold text-zinc-950">
                      {className}
                    </h3>
                    <dl className="mt-3 space-y-1 text-sm text-zinc-600">
                      <div className="flex justify-between gap-4">
                        <dt className="text-zinc-500">Time</dt>
                        <dd className="text-right text-zinc-950">
                          {startFormatted}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-zinc-500">Room</dt>
                        <dd className="text-right text-zinc-950">
                          {roomName}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-zinc-500">Instructor</dt>
                        <dd className="text-right text-zinc-950">
                          {staffDisplayName}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="mt-5">
                    <SubRequestButton
                      occurrenceId={occurrence.id}
                      className={className}
                      startFormatted={startFormatted}
                      roomName={roomName}
                      staffDisplayName={staffDisplayName}
                      requestedBy={staffId}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
