import { DateTime } from "luxon";
import { CurrentUserBanner } from "@/components/current-user-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { StaffSelect } from "@/components/staff-select";
import { getCurrentStaff, resolveViewedStaffId } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { formatClassTime } from "@/lib/format-class-time";
import { getActiveStaff } from "@/lib/staff";
import { DateNav } from "./date-nav";
import { SubRequestButton } from "./sub-request-button";

type ScheduleOccurrenceRow = {
  id: string;
  class_name: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
  substitute_staff_id: string | null;
  staff: { display_name: string } | null;
  department: { name: string | null } | null;
  room: { name: string | null } | null;
};

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  // Single-org sandbox today (see app/api/sync/classes/route.ts) -- one row,
  // upserted by mindbody_site_id. Same simplification as the rest of the app.
  const { data } = await supabase
    .from("organizations")
    .select("timezone")
    .limit(1)
    .maybeSingle();

  return data?.timezone ?? "utc";
}

async function getScheduleForStaffOnDate(
  supabase: ScopedSupabaseClient,
  staffId: string,
  date: string,
  timezone: string,
) {
  const dayStart = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });

  const { data, error } = await supabase
    .from("class_occurrences")
    .select(
      `
      id,
      class_name,
      start_datetime,
      end_datetime,
      substitute_staff_id,
      staff:staff!class_occurrences_staff_id_fkey ( display_name ),
      department:departments!class_occurrences_department_id_fkey ( name ),
      room:rooms!class_occurrences_room_id_fkey ( name )
      `,
    )
    // Own classes, or classes they're covering as an approved substitute --
    // the latter matters so a substitute who can't make it after all can
    // still hit Create Sub Request on it themselves (which will supersede
    // the approved request -- see app/api/substitution-requests/route.ts).
    .or(`staff_id.eq.${staffId},substitute_staff_id.eq.${staffId}`)
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

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; staffId?: string }>;
}) {
  const params = await searchParams;

  // A real session always wins over the "select your name" stand-in --
  // once someone has a login, they no longer pick themselves from a
  // dropdown. Staff without a login yet still use the dropdown exactly as
  // before.
  const currentStaff = await getCurrentStaff();
  const staffId = await resolveViewedStaffId(currentStaff, params.staffId ?? null);

  // Adam's real session -> RLS-scoped client, so the org/select policies are
  // the actual enforcement. Everyone else (dropdown, no session yet) -> the
  // admin client, same as before -- RLS has no way to authorize a
  // session-less caller, so this preserves current behavior.
  const supabase = await getScopedClient(currentStaff);
  const timezone = await getOrgTimezone(supabase);

  const date =
    params.date ?? DateTime.now().setZone(timezone).toISODate() ?? "";

  const staffOptions = await getActiveStaff();
  const occurrences = staffId
    ? await getScheduleForStaffOnDate(supabase, staffId, date, timezone)
    : [];

  return (
    <DashboardShell
      title="My Schedule"
      description="Your own class schedule, day by day -- request a substitute directly from a class card."
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        {currentStaff ? (
          <CurrentUserBanner
            displayName={currentStaff.displayName}
            role={currentStaff.role}
          />
        ) : (
          <StaffSelect staffOptions={staffOptions} staffId={staffId} />
        )}
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
              const timeFormatted = formatClassTime(
                occurrence.start_datetime,
                occurrence.end_datetime,
                timezone,
              );
              const roomName = occurrence.room?.name ?? "Not assigned";
              const staffDisplayName = occurrence.staff?.display_name ?? "";
              const isCovering = occurrence.substitute_staff_id === staffId;

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
                          {timeFormatted}
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
                          {isCovering ? " (you're covering)" : ""}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="mt-5">
                    <SubRequestButton
                      occurrenceId={occurrence.id}
                      className={className}
                      timeFormatted={timeFormatted}
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
