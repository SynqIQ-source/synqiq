import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { canCheckIn } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { CALENDAR_DAYS } from "@/lib/sync/class-calendar";

type SessionRow = {
  id: string;
  class_name: string;
  local_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  capacity: number | null;
  staff_mindbody_id: number | null;
  mindbody_resource_id: number | null;
  mindbody_class_schedule_id: number | null;
  removed_from_schedule_at: string | null;
  edits: Record<string, CatalogValue> | null;
};

const time = (value: unknown) => (typeof value === "string" ? DateTime.fromFormat(value.slice(0, 5), "HH:mm").toFormat("h:mm a") : "—");

// Classes on SynqIQ's calendar for a day, with spots taken (Mindbody's
// bookings + SynqIQ's), to book people in.
export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ date?: string; pool?: string }> }) {
  const staff = await requireAccess(canCheckIn);
  const admin = createSupabaseAdminClient();
  const orgId = staff.organizationId;
  const params = await searchParams;
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  const timezone = (org?.timezone as string | undefined) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone);
  const last = today.plus({ days: CALENDAR_DAYS }).toISODate()!;
  const date =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date >= today.toISODate()! && params.date <= last
      ? params.date
      : today.toISODate()!;
  const showPool = params.pool === "1";

  const { data: rows } = await admin
    .from("class_sessions")
    .select(
      "id, class_name, local_date, start_time, end_time, starts_at, capacity, staff_mindbody_id, mindbody_resource_id, mindbody_class_schedule_id, removed_from_schedule_at, edits",
    )
    .eq("organization_id", orgId)
    .eq("local_date", date)
    .order("starts_at")
    .returns<SessionRow[]>();
  const sessions = (rows ?? []).filter((row) => showPool || !/pool lane/i.test(row.class_name));
  const ids = sessions.map((row) => row.id);
  const dayStart = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  const [{ data: occurrences }, { data: bookings }, { data: rooms }, { data: teachers }] = await Promise.all([
    admin
      .from("class_occurrences")
      .select("id, mindbody_class_schedule_id, start_datetime, total_booked")
      .eq("organization_id", orgId)
      .gte("start_datetime", dayStart.toUTC().toISO()!)
      .lt("start_datetime", dayStart.plus({ days: 1 }).toUTC().toISO()!),
    ids.length
      ? admin.from("class_bookings").select("class_session_id, status").in("class_session_id", ids)
      : Promise.resolve({ data: [] as { class_session_id: string; status: string }[] }),
    admin.from("rooms").select("mindbody_resource_id, name").eq("organization_id", orgId),
    admin.from("staff").select("mindbody_staff_id, display_name").eq("organization_id", orgId).not("mindbody_staff_id", "is", null),
  ]);
  const mindbody = new Map(
    (occurrences ?? []).map((row) => [`${row.mindbody_class_schedule_id}|${Date.parse(row.start_datetime as string)}`, row]),
  );
  const synqiq = new Map<string, { booked: number; waitlist: number }>();
  for (const booking of bookings ?? []) {
    const entry = synqiq.get(booking.class_session_id) ?? { booked: 0, waitlist: 0 };
    if (booking.status === "booked" || booking.status === "checked_in") entry.booked += 1;
    if (booking.status === "waitlisted") entry.waitlist += 1;
    synqiq.set(booking.class_session_id, entry);
  }
  const roomName = new Map((rooms ?? []).map((room) => [Number(room.mindbody_resource_id), room.name as string]));
  const teacherName = new Map((teachers ?? []).map((row) => [Number(row.mindbody_staff_id), row.display_name as string]));
  const day = DateTime.fromISO(date);
  const href = (next: { date?: string; pool?: boolean }) => {
    const query = new URLSearchParams();
    const nextDate = next.date ?? date;
    if (nextDate !== today.toISODate()) query.set("date", nextDate);
    if (next.pool ?? showPool) query.set("pool", "1");
    const text = query.toString();
    return `/dashboard/bookings${text ? `?${text}` : ""}`;
  };

  return (
    <DashboardShell title="Bookings" description="Book members into classes on SynqIQ's calendar. Spots count Mindbody's bookings too.">
      <div className="space-y-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Bookings made here stay in SynqIQ; they don&apos;t go to Mindbody until the switch. Mindbody&apos;s bookings are counted in the
          spots.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {date > today.toISODate()! ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href({ date: day.minus({ days: 1 }).toISODate()! })} aria-label="Previous day">
                <ChevronLeft />
              </Link>
            </Button>
          ) : null}
          <span className="text-sm font-medium">{date === today.toISODate() ? "Today" : day.toFormat("cccc, LLL d")}</span>
          {date < last ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href({ date: day.plus({ days: 1 }).toISODate()! })} aria-label="Next day">
                <ChevronRight />
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <Link href={href({ pool: !showPool })}>{showPool ? "Hide pool lanes" : "Show pool lanes"}</Link>
          </Button>
        </div>
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>{sessions.length} classes</CardTitle>
            <CardDescription>Open a class to book someone, manage the waitlist and check people in.</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Instructor</TableHead>
                <TableHead className="text-right">Spots</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((row) => {
                const merged = effective("class_session", row);
                const cancelled = merged.active === false || Boolean(row.removed_from_schedule_at);
                const occurrence = mindbody.get(`${row.mindbody_class_schedule_id}|${Date.parse(row.starts_at)}`);
                const ours = synqiq.get(row.id) ?? { booked: 0, waitlist: 0 };
                const taken = Number(occurrence?.total_booked ?? 0) + ours.booked;
                const capacity = (merged.capacity as number | null) ?? null;
                return (
                  <TableRow key={row.id} className={cancelled ? "text-muted-foreground" : undefined}>
                    <TableCell className="whitespace-nowrap tabular-nums">{time(merged.start_time)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/dashboard/bookings/${row.id}`}
                        className={`font-medium underline-offset-4 hover:underline ${cancelled ? "line-through" : ""}`}
                      >
                        {row.class_name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {merged.mindbody_resource_id ? roomName.get(merged.mindbody_resource_id as number) : ""}
                        {cancelled ? " · Cancelled" : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {merged.staff_mindbody_id ? (teacherName.get(merged.staff_mindbody_id as number) ?? "—") : "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className="tabular-nums">
                        {taken}
                        {capacity ? ` / ${capacity}` : ""}
                      </span>
                      {capacity && taken >= capacity ? (
                        <Badge variant="outline" className="ml-2">
                          Full
                        </Badge>
                      ) : null}
                      {ours.booked ? <span className="block text-xs text-muted-foreground">{ours.booked} via SynqIQ</span> : null}
                      {ours.waitlist ? <span className="block text-xs text-muted-foreground">{ours.waitlist} waitlisted</span> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {sessions.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">No classes this day.</p> : null}
        </Card>
      </div>
    </DashboardShell>
  );
}
