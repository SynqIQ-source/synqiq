import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { compareWithMindbody, type CalendarMatch, type MindbodyClass } from "@/lib/classes/calendar";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { CatalogEditDialog } from "./edit-dialog";

// SynqIQ's class calendar for the booking window, compared with Mindbody's
// classes on the same dates (parallel run). Each date can be changed or
// cancelled on its own.

export type SessionRow = {
  id: string;
  class_name: string;
  local_date: string;
  start_time: string;
  end_time: string;
  mindbody_resource_id: number | null;
  capacity: number | null;
  staff_mindbody_id: number | null;
  mindbody_class_schedule_id: number | null;
  starts_at: string;
  removed_from_schedule_at: string | null;
  edits: Record<string, CatalogValue> | null;
};

type Option = { value: number; label: string };

const MATCH_LABEL: Record<CalendarMatch, string | null> = {
  match: null,
  time_differs: "Time differs from Mindbody",
  instructor_differs: "Mindbody has a different instructor",
  only_synqiq: "Not in Mindbody",
};

const time = (value: unknown) => (typeof value === "string" ? DateTime.fromFormat(value.slice(0, 5), "HH:mm").toFormat("h:mm a") : "—");

export function CalendarTab({
  sessions,
  mindbodyByDate,
  roomName,
  staffName,
  rooms,
  instructors,
  timezone,
}: {
  sessions: SessionRow[];
  mindbodyByDate: Map<string, MindbodyClass[]>;
  roomName: Map<number, string>;
  staffName: Map<number, string>;
  rooms: Option[];
  instructors: Option[];
  timezone: string;
}) {
  const isPool = (session: SessionRow) => /pool lane/i.test(session.class_name);
  const dates = [...new Set(sessions.map((session) => session.local_date))].sort();
  const counts: Record<CalendarMatch, number> = { match: 0, time_differs: 0, instructor_differs: 0, only_synqiq: 0 };
  const enriched = sessions.map((session) => {
    const merged = effective("class_session", session);
    const changedTime = merged.start_time !== session.start_time;
    const match = compareWithMindbody(
      {
        mindbody_class_schedule_id: session.mindbody_class_schedule_id,
        starts_at: session.starts_at,
        staff_mindbody_id: (merged.staff_mindbody_id as number | null) ?? null,
      },
      mindbodyByDate.get(session.local_date) ?? [],
    );
    if (!session.removed_from_schedule_at && merged.active !== false) counts[match] += 1;
    return { session, merged, match: changedTime && match === "match" ? ("time_differs" as CalendarMatch) : match };
  });
  const mindbodyTotal = [...mindbodyByDate.values()].reduce((sum, list) => sum + list.length, 0);
  const today = DateTime.now().setZone(timezone).toISODate()!;

  return (
    <div className="space-y-6">
      <Card className="py-4">
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Classes on SynqIQ's calendar" value={sessions.length} sub={`${dates[0] ?? ""} – ${dates[dates.length - 1] ?? ""}`} />
          <Stat label="Match Mindbody" value={counts.match} sub={`of ${mindbodyTotal} Mindbody classes`} />
          <Stat label="Differ from Mindbody" value={counts.time_differs + counts.instructor_differs} sub="time or instructor" />
          <Stat label="Only in SynqIQ" value={counts.only_synqiq} sub="new here, or Mindbody removed it" />
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Built each night from the weekly schedule (next 21 days, the booking window). Changing one date here doesn&apos;t change the weekly
        schedule. Pool lanes are counted but not listed.
      </p>
      <div className="space-y-4">
        {dates.map((date) => {
          const day = enriched.filter((item) => item.session.local_date === date);
          const classes = day
            .filter((item) => !isPool(item.session))
            .sort((a, b) => String(a.merged.start_time).localeCompare(String(b.merged.start_time)));
          const pool = day.filter((item) => isPool(item.session)).length;
          return (
            <Card key={date} className="gap-2 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-base">
                  {DateTime.fromISO(date).toFormat("cccc, LLL d")}
                  {date === today ? <Badge className="ml-2">Today</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {classes.length} classes{pool ? ` · ${pool} pool lane slots` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 px-4 sm:grid-cols-2 xl:grid-cols-3">
                {classes.map(({ session, merged, match }) => {
                  const cancelled = merged.active === false || Boolean(session.removed_from_schedule_at);
                  const instructor = merged.staff_mindbody_id ? staffName.get(merged.staff_mindbody_id as number) : null;
                  return (
                    <div
                      key={session.id}
                      className={`flex items-start justify-between gap-1 rounded-md border px-2 py-1.5 text-sm ${cancelled ? "opacity-60" : ""}`}
                    >
                      <div className="min-w-0">
                        <a
                          href={`/dashboard/bookings/${session.id}`}
                          className={`block font-medium underline-offset-4 hover:underline ${cancelled ? "line-through" : ""}`}
                        >
                          {session.class_name}
                        </a>
                        <p className="text-xs text-muted-foreground">
                          {time(merged.start_time)}–{time(merged.end_time)}
                          {merged.mindbody_resource_id ? ` · ${roomName.get(merged.mindbody_resource_id as number) ?? "Room"}` : ""}
                          {merged.capacity ? ` · ${merged.capacity} spots` : ""}
                        </p>
                        {instructor ? <p className="text-xs text-muted-foreground">{instructor}</p> : null}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {merged.active === false ? <Badge variant="destructive">Cancelled</Badge> : null}
                          {session.removed_from_schedule_at ? <Badge variant="outline">No longer on the weekly schedule</Badge> : null}
                          {session.edits?.sub_source && merged.active !== false ? (
                            <Badge variant="secondary">
                              {session.edits.sub_source === "synqiq" ? "Sub (approved in SynqIQ)" : "Sub (set in Mindbody)"}
                            </Badge>
                          ) : null}
                          {merged.edited.filter((field) => !(field === "staff_mindbody_id" && session.edits?.sub_source)).length &&
                          merged.active !== false ? (
                            <Badge variant="outline">Changed for this date</Badge>
                          ) : null}
                          {!cancelled && MATCH_LABEL[match] ? (
                            <Badge variant="outline" className="border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200">
                              {MATCH_LABEL[match]}
                            </Badge>
                          ) : null}
                        </div>
                        {merged.note ? <p className="mt-1 text-xs text-muted-foreground">{merged.note as string}</p> : null}
                      </div>
                      <CatalogEditDialog
                        entity="class_session"
                        id={session.id}
                        title={`${session.class_name} · ${DateTime.fromISO(date).toFormat("ccc LLL d")}`}
                        values={{
                          start_time: merged.start_time as CatalogValue,
                          end_time: merged.end_time as CatalogValue,
                          mindbody_resource_id: (merged.mindbody_resource_id as CatalogValue) ?? null,
                          capacity: (merged.capacity as CatalogValue) ?? null,
                          staff_mindbody_id: (merged.staff_mindbody_id as CatalogValue) ?? null,
                          active: merged.active as CatalogValue,
                          note: (merged.note as CatalogValue) ?? null,
                        }}
                        edited={merged.edited}
                        rooms={rooms}
                        instructors={instructors}
                        triggerLabel={`Change ${session.class_name} on ${date}`}
                        compact
                      />
                    </div>
                  );
                })}
                {classes.length === 0 ? <p className="text-sm text-muted-foreground">No classes.</p> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
