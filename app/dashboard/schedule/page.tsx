import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { CalendarX2, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StaffNotProvisioned } from "@/components/staff-not-provisioned";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { formatClassTime } from "@/lib/format-class-time";
import { DateNav } from "./date-nav";
import { SubRequestButton } from "./sub-request-button";

const TITLE = "My Schedule";
const DESCRIPTION =
  "Your classes, day by day. Need cover? Request a sub right from the class.";

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
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;

  // middleware.ts already guarantees a real Supabase Auth session for
  // anything under /dashboard/* -- currentStaff can still be null here in
  // one narrow case (a valid session with no linked staff row), handled
  // below, not the old dropdown-mode fallback.
  const currentStaff = await getCurrentStaff();

  if (!currentStaff) {
    return (
      <DashboardShell title={TITLE} description={DESCRIPTION}>
        <StaffNotProvisioned />
      </DashboardShell>
    );
  }

  const staffId = currentStaff.id;
  const supabase = await getScopedClient(currentStaff);
  const timezone = await getOrgTimezone(supabase);

  const date =
    params.date ?? DateTime.now().setZone(timezone).toISODate() ?? "";

  const occurrences = await getScheduleForStaffOnDate(supabase, staffId, date, timezone);

  const today = DateTime.now().setZone(timezone).toISODate() ?? "";
  const dayLabel = date === today ? "Today" : DateTime.fromISO(date).toFormat("cccc");

  return (
    <DashboardShell title={TITLE} description={DESCRIPTION}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{dayLabel}</p>
            <h2 className="text-lg font-semibold tracking-tight">{DateTime.fromISO(date).toFormat("LLLL d, yyyy")}</h2>
          </div>
          <DateNav date={date} today={today} />
        </div>

        {occurrences.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <CalendarX2 className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No classes scheduled</p>
              <p className="text-sm text-muted-foreground">
                You have nothing on {DateTime.fromISO(date).toFormat("cccc, LLL d")}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {occurrences.length} class{occurrences.length === 1 ? "" : "es"}
            </p>
            {occurrences.map((occurrence) => {
              const className = occurrence.class_name?.trim() || "Unknown class";
              const timeFormatted = formatClassTime(occurrence.start_datetime, occurrence.end_datetime, timezone);
              const roomName = occurrence.room?.name ?? "Not assigned";
              const staffDisplayName = occurrence.staff?.display_name ?? "";
              const isCovering = occurrence.substitute_staff_id === staffId;
              const start = occurrence.start_datetime
                ? DateTime.fromISO(occurrence.start_datetime, { zone: "utc" }).setZone(timezone)
                : null;
              const end = occurrence.end_datetime
                ? DateTime.fromISO(occurrence.end_datetime, { zone: "utc" }).setZone(timezone)
                : null;

              return (
                <Card key={occurrence.id} className="py-0">
                  <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                    <div className="flex w-24 shrink-0 flex-col">
                      <span className="text-lg font-semibold tabular-nums">{start ? start.toFormat("h:mm") : "—"}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {start ? start.toFormat("a") : ""}
                        {end ? ` – ${end.toFormat("h:mm a")}` : ""}
                      </span>
                    </div>
                    <div className="hidden w-px self-stretch bg-border sm:block" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{className}</h3>
                        {isCovering ? <Badge variant="secondary">Covering for {staffDisplayName}</Badge> : null}
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        {roomName}
                      </p>
                    </div>
                    <div className="sm:w-48">
                      <SubRequestButton
                        occurrenceId={occurrence.id}
                        className={className}
                        timeFormatted={timeFormatted}
                        roomName={roomName}
                        staffDisplayName={staffDisplayName}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
