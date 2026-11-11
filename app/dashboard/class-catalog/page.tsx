import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { DAY_NAMES } from "@/lib/classes/catalog";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { CatalogEditDialog } from "./edit-dialog";
import { CatalogCreateDialog } from "./create-dialog";
import { WidgetTab } from "./widget-tab";
import { CalendarTab, type SessionRow } from "./calendar-tab";
import { CALENDAR_DAYS } from "@/lib/sync/class-calendar";
import type { MindbodyClass } from "@/lib/classes/calendar";

// The class catalog: imported from Mindbody nightly, editable here (edits
// win over Mindbody's copy and are logged). Class types and descriptions,
// the weekly schedule, rooms, programs with booking rules, appointment
// types. Club Admins only.

type Edits = { edits: Record<string, CatalogValue> | null };
type ClassType = Edits & {
  id: string;
  source: string;
  mindbody_class_description_id: number;
  name: string;
  description_text: string | null;
  level: string | null;
  category: string | null;
  subcategory: string | null;
  mindbody_program_id: number | null;
  active: boolean;
};
type Schedule = Edits & {
  id: string;
  source: string;
  class_type_id: string | null;
  mindbody_class_description_id: number | null;
  class_name: string | null;
  days: number[];
  start_time: string | null;
  end_time: string | null;
  end_date: string | null;
  staff_mindbody_id: number | null;
  mindbody_resource_id: number | null;
  capacity: number | null;
  last_class_at: string | null;
};
type Program = Edits & {
  id: string;
  mindbody_program_id: number;
  name: string;
  schedule_type: string | null;
  cancel_window_minutes: number | null;
  booking_opens_days: number | null;
  booking_closes_minutes: number | null;
};
type Room = Edits & { id: string; mindbody_resource_id: number; name: string; active: boolean };
type SessionType = Edits & {
  id: string;
  name: string;
  kind: string | null;
  default_minutes: number | null;
  mindbody_program_id: number | null;
  available_online: boolean | null;
  online_description: string | null;
};

const time = (value: unknown) => (typeof value === "string" ? DateTime.fromFormat(value.slice(0, 5), "HH:mm").toFormat("h:mm a") : "—");
const minutes = (value: unknown) => {
  if (typeof value !== "number") return "—";
  if (value === 0) return "none";
  if (value % 1440 === 0) return `${value / 1440} day${value === 1440 ? "" : "s"}`;
  if (value % 60 === 0) return `${value / 60} hr`;
  return `${value} min`;
};
const money = (cents: unknown) => (typeof cents === "number" && cents > 0 ? `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}` : "—");
const pick = (row: Record<string, unknown>, fields: string[]) =>
  Object.fromEntries(fields.map((field) => [field, (row[field] ?? null) as CatalogValue]));

function Edited({ show }: { show: boolean }) {
  return show ? (
    <Badge variant="outline" className="border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200">
      edited
    </Badge>
  ) : null;
}

export default async function ClassCatalogPage() {
  const staff = await requireAccess(isClubAdmin);
  const supabase = await getScopedClient(staff);
  const orgId = staff.organizationId;
  const [
    { data: classTypeRows },
    { data: scheduleRows },
    { data: programRows },
    { data: roomRows },
    { data: sessionRows },
    { data: teacherRows },
  ] = await Promise.all([
    supabase
      .from("class_types")
      .select(
        "id, source, mindbody_class_description_id, name, description_text, level, category, subcategory, mindbody_program_id, active, edits",
      )
      .eq("organization_id", orgId)
      .order("name")
      .returns<ClassType[]>(),
    supabase
      .from("class_schedules")
      .select(
        "id, source, class_type_id, mindbody_class_description_id, class_name, days, start_time, end_time, end_date, staff_mindbody_id, mindbody_resource_id, capacity, last_class_at, edits",
      )
      .eq("organization_id", orgId)
      .order("start_time")
      .returns<Schedule[]>(),
    supabase
      .from("departments")
      .select("id, mindbody_program_id, name, schedule_type, cancel_window_minutes, booking_opens_days, booking_closes_minutes, edits")
      .eq("organization_id", orgId)
      .not("synced_at", "is", null)
      .order("name")
      .returns<Program[]>(),
    supabase
      .from("rooms")
      .select("id, mindbody_resource_id, name, active, edits")
      .eq("organization_id", orgId)
      .order("name")
      .returns<Room[]>(),
    supabase
      .from("session_types")
      .select("id, name, kind, default_minutes, mindbody_program_id, available_online, online_description, edits")
      .eq("organization_id", orgId)
      .order("name")
      .returns<SessionType[]>(),
    supabase
      .from("staff")
      .select("mindbody_staff_id, display_name, is_instructor")
      .eq("organization_id", orgId)
      .not("mindbody_staff_id", "is", null)
      .order("display_name"),
  ]);

  const classTypes = (classTypeRows ?? []).map((row) => effective("class_type", row));
  const programs = (programRows ?? []).map((row) => effective("program", row));
  const rooms = (roomRows ?? []).map((row) => effective("room", row));
  const sessionTypes = (sessionRows ?? []).map((row) => effective("session_type", row));
  // A schedule is running if it had a class in the last 30 days and hasn't
  // been taken off the schedule in SynqIQ.
  const cutoff = DateTime.now().minus({ days: 30 }).toISO()!;
  const allRunning = (scheduleRows ?? [])
    .filter((row) => row.source === "synqiq" || (row.last_class_at && Date.parse(row.last_class_at) >= Date.parse(cutoff)))
    .map((row) => effective("class_schedule", row));
  const running = allRunning.filter((schedule) => schedule.active !== false);
  const removed = allRunning.filter((schedule) => schedule.active === false);

  const programName = new Map(programs.map((program) => [program.mindbody_program_id, program.name as string]));
  const roomName = new Map(rooms.map((room) => [room.mindbody_resource_id, room.name as string]));
  const typeName = new Map(classTypes.map((type) => [type.mindbody_class_description_id, type.name as string]));
  const typeNameById = new Map(classTypes.map((type) => [type.id, type.name as string]));
  const staffName = new Map((teacherRows ?? []).map((row) => [Number(row.mindbody_staff_id), row.display_name as string]));
  const roomOptions = rooms
    .filter((room) => room.active !== false)
    .map((room) => ({ value: room.mindbody_resource_id, label: room.name as string }));
  const instructorOptions = (teacherRows ?? [])
    .filter((row) => row.is_instructor)
    .map((row) => ({ value: Number(row.mindbody_staff_id), label: row.display_name as string }));

  const className = (schedule: (typeof running)[number]) =>
    (schedule.class_type_id ? typeNameById.get(schedule.class_type_id) : null) ??
    (schedule.mindbody_class_description_id ? typeName.get(schedule.mindbody_class_description_id) : null) ??
    schedule.class_name ??
    "Class";
  const isPool = (schedule: (typeof running)[number]) => /pool lane/i.test(schedule.class_name ?? "");
  const poolSlots = running.filter(isPool);
  const classSlots = running.filter((schedule) => !isPool(schedule));
  const days = (schedule: (typeof running)[number]) => (schedule.days as number[]) ?? [];
  const weeklyByType = new Map<string, number>();
  for (const schedule of running) {
    if (schedule.class_type_id)
      weeklyByType.set(schedule.class_type_id, (weeklyByType.get(schedule.class_type_id) ?? 0) + days(schedule).length);
  }
  const offered = classTypes.filter((type) => weeklyByType.has(type.id) || (type.source === "synqiq" && type.active !== false));
  const notOffered = classTypes.filter((type) => !offered.includes(type) && type.active);
  const roomUse = new Map<number, number>();
  for (const schedule of running) {
    const room = schedule.mindbody_resource_id as number | null;
    if (room) roomUse.set(room, (roomUse.get(room) ?? 0) + days(schedule).length);
  }
  const bookable = programs.filter((program) => program.schedule_type === "Class" || program.schedule_type === "Appointment");

  // SynqIQ's calendar and Mindbody's classes over the same dates.
  const { data: org } = await supabase.from("organizations").select("timezone, mindbody_site_id").eq("id", orgId).maybeSingle();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://synqiq.co").replace(/\/$/, "");
  const timezone = (org?.timezone as string | undefined) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone);
  const windowEnd = today.plus({ days: CALENDAR_DAYS });
  const [{ data: calendarRows }, { data: mindbodyRows }, { data: staffIdRows }] = await Promise.all([
    supabase
      .from("class_sessions")
      .select(
        "id, class_name, local_date, start_time, end_time, mindbody_resource_id, capacity, staff_mindbody_id, mindbody_class_schedule_id, starts_at, removed_from_schedule_at, edits",
      )
      .eq("organization_id", orgId)
      .gte("local_date", today.toISODate()!)
      .lte("local_date", windowEnd.toISODate()!)
      .order("starts_at")
      .limit(5000)
      .returns<SessionRow[]>(),
    supabase
      .from("class_occurrences")
      .select("mindbody_class_schedule_id, start_datetime, staff_id")
      .eq("organization_id", orgId)
      .gte("start_datetime", today.startOf("day").toUTC().toISO()!)
      .lte("start_datetime", windowEnd.endOf("day").toUTC().toISO()!)
      .limit(5000),
    supabase.from("staff").select("id, mindbody_staff_id").eq("organization_id", orgId).not("mindbody_staff_id", "is", null),
  ]);
  const mindbodyStaffById = new Map((staffIdRows ?? []).map((row) => [row.id as string, Number(row.mindbody_staff_id)]));
  const mindbodyByDate = new Map<string, MindbodyClass[]>();
  for (const row of mindbodyRows ?? []) {
    const date = DateTime.fromISO(row.start_datetime as string)
      .setZone(timezone)
      .toISODate()!;
    mindbodyByDate.set(date, [
      ...(mindbodyByDate.get(date) ?? []),
      {
        scheduleId: row.mindbody_class_schedule_id ? Number(row.mindbody_class_schedule_id) : null,
        startsAt: row.start_datetime as string,
        staffMindbodyId: row.staff_id ? (mindbodyStaffById.get(row.staff_id as string) ?? null) : null,
      },
    ]);
  }
  const programOptions = bookable
    .filter((program) => program.schedule_type === "Class")
    .map((program) => ({ value: program.mindbody_program_id, label: program.name as string }));
  const classTypeOptions = classTypes
    .filter((type) => type.active !== false && (weeklyByType.has(type.id) || type.source === "synqiq" || type.active))
    .map((type) => ({ value: type.id, label: type.name as string }));

  return (
    <DashboardShell
      title="Class Catalog"
      description="Classes, schedules, rooms and booking rules. Imported from Mindbody each night; edits made here win and are kept. Mindbody still runs booking until the switch."
    >
      <div className="space-y-6">
        <Card className="py-4">
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Class types offered" value={offered.length} />
            <Stat label="Classes a week" value={classSlots.reduce((sum, schedule) => sum + days(schedule).length, 0)} />
            <Stat label="Pool lane slots a week" value={poolSlots.reduce((sum, schedule) => sum + days(schedule).length, 0)} />
            <Stat label="Rooms" value={rooms.filter((room) => room.active !== false).length} />
            <Stat label="Appointment types" value={sessionTypes.filter((type) => type.kind === "Appointment").length} />
          </CardContent>
        </Card>
        {(scheduleRows ?? []).length ? null : <p className="text-sm text-muted-foreground">Not imported yet.</p>}

        <Tabs defaultValue="schedule">
          <TabsList className="flex-wrap">
            <TabsTrigger value="schedule">Weekly schedule</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="types">Class types</TabsTrigger>
            <TabsTrigger value="rules">Booking rules</TabsTrigger>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            <TabsTrigger value="appointments">Appointment types</TabsTrigger>
            <TabsTrigger value="widget">Website widget</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar">
            <CalendarTab
              sessions={calendarRows ?? []}
              mindbodyByDate={mindbodyByDate}
              roomName={roomName}
              staffName={staffName}
              rooms={roomOptions}
              instructors={instructorOptions}
              timezone={timezone}
            />
          </TabsContent>

          <TabsContent value="schedule" className="space-y-6">
            <div className="flex justify-end">
              <CatalogCreateDialog
                entity="class_schedule"
                label="Add class time"
                today={today.toISODate()!}
                classTypes={classTypeOptions}
                rooms={roomOptions}
                instructors={instructorOptions}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const slots = classSlots
                  .filter((schedule) => days(schedule).includes(day))
                  .sort((a, b) => String(a.start_time ?? "").localeCompare(String(b.start_time ?? "")));
                return (
                  <Card key={day} className="gap-2 py-4">
                    <CardHeader className="px-4">
                      <CardTitle className="text-base">
                        {DAY_NAMES[day]} <span className="text-sm font-normal text-muted-foreground">· {slots.length} classes</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 px-4">
                      {slots.map((schedule) => (
                        <div key={schedule.id} className="flex items-start justify-between gap-1 rounded-md border px-2 py-1.5 text-sm">
                          <div className="min-w-0">
                            <p className="font-medium">
                              {className(schedule)} <Edited show={schedule.edited.length > 0} />
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {time(schedule.start_time)}–{time(schedule.end_time)}
                              {schedule.mindbody_resource_id ? ` · ${roomName.get(schedule.mindbody_resource_id as number) ?? "Room"}` : ""}
                              {schedule.capacity ? ` · ${schedule.capacity} spots` : ""}
                            </p>
                            {schedule.staff_mindbody_id && staffName.get(schedule.staff_mindbody_id as number) ? (
                              <p className="text-xs text-muted-foreground">{staffName.get(schedule.staff_mindbody_id as number)}</p>
                            ) : null}
                          </div>
                          <CatalogEditDialog
                            entity="class_schedule"
                            id={schedule.id}
                            title={`${className(schedule)} · ${time(schedule.start_time)}`}
                            values={pick(schedule, [
                              "days",
                              "start_time",
                              "end_time",
                              "mindbody_resource_id",
                              "capacity",
                              "staff_mindbody_id",
                              "end_date",
                              "active",
                            ])}
                            edited={schedule.edited}
                            rooms={roomOptions}
                            instructors={instructorOptions}
                            triggerLabel={`Edit ${className(schedule)}`}
                            compact
                          />
                        </div>
                      ))}
                      {slots.length === 0 ? <p className="text-sm text-muted-foreground">No classes.</p> : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">
              Pool lanes: {poolSlots.length} lane-slots ({poolSlots.reduce((sum, schedule) => sum + days(schedule).length, 0)} a week), 2
              swimmers each. Schedules shown are ones with a class in the last 30 days.
              {removed.length
                ? ` Taken off the schedule in SynqIQ: ${removed.map((schedule) => `${className(schedule)} ${time(schedule.start_time)}`).join(", ")}.`
                : ""}
            </p>
          </TabsContent>

          <TabsContent value="types" className="space-y-4">
            <div className="flex justify-end">
              <CatalogCreateDialog entity="class_type" label="New class type" today={today.toISODate()!} programs={programOptions} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {offered.map((type) => (
                <Card key={type.id} className="gap-2 py-4">
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 px-4">
                    <div className="min-w-0 space-y-1.5">
                      <CardTitle className="text-base">
                        {type.name as string} <Edited show={type.edited.length > 0} />
                      </CardTitle>
                      <CardDescription className="flex flex-wrap gap-1">
                        {type.mindbody_program_id ? (
                          <Badge variant="secondary">{programName.get(type.mindbody_program_id) ?? "Program"}</Badge>
                        ) : null}
                        {type.category ? <Badge variant="outline">{type.category as string}</Badge> : null}
                        {type.subcategory ? <Badge variant="outline">{type.subcategory}</Badge> : null}
                        {type.level ? <Badge variant="outline">{type.level as string}</Badge> : null}
                        <Badge variant="outline">{weeklyByType.get(type.id) ?? 0} a week</Badge>
                        {type.source === "synqiq" ? <Badge variant="outline">Added in SynqIQ</Badge> : null}
                        {type.active === false ? <Badge variant="destructive">Not offered</Badge> : null}
                      </CardDescription>
                    </div>
                    <CatalogEditDialog
                      entity="class_type"
                      id={type.id}
                      title={type.name as string}
                      values={pick(type, ["name", "description_text", "level", "category", "active"])}
                      edited={type.edited}
                    />
                  </CardHeader>
                  <CardContent className="px-4">
                    <p className="text-sm whitespace-pre-line text-muted-foreground">
                      {(type.description_text as string | null) ?? "No description."}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            {notOffered.length ? (
              <p className="text-sm text-muted-foreground">
                Active in Mindbody but not on the current schedule: {notOffered.map((type) => type.name as string).join(", ")}.
              </p>
            ) : null}
          </TabsContent>

          <TabsContent value="rules">
            <Card className="py-0">
              <CardHeader className="pt-6">
                <CardTitle>Booking rules by program</CardTitle>
                <CardDescription>
                  Cancelling inside the late-cancel window counts as late. Programs not included in membership are paid separately (packs or
                  drop-ins).
                </CardDescription>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Program</TableHead>
                      <TableHead>In membership</TableHead>
                      <TableHead>Booking opens</TableHead>
                      <TableHead>Online booking closes</TableHead>
                      <TableHead>Late cancel</TableHead>
                      <TableHead>Fees (late / no-show)</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookable.map((program) => (
                      <TableRow key={program.id}>
                        <TableCell>
                          <span className="font-medium">{program.name}</span>
                          <span className="block text-xs text-muted-foreground">{program.schedule_type}</span>
                        </TableCell>
                        <TableCell>
                          {program.included_in_membership === false ? (
                            <Badge variant="outline">Paid separately</Badge>
                          ) : (
                            <Badge variant="secondary">Included</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {typeof program.booking_opens_days === "number" && program.booking_opens_days > 0
                            ? `${program.booking_opens_days} days ahead`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {typeof program.booking_closes_minutes === "number" && program.booking_closes_minutes > 0
                            ? `${minutes(program.booking_closes_minutes)} ${program.schedule_type === "Appointment" ? "notice" : "before"}`
                            : "—"}
                        </TableCell>
                        <TableCell>{minutes(program.cancel_window_minutes)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {money(program.late_cancel_fee_cents)} / {money(program.no_show_fee_cents)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center gap-1">
                            <Edited show={program.edited.length > 0} />
                            <CatalogEditDialog
                              entity="program"
                              id={program.id}
                              title={`${program.name} booking rules`}
                              values={pick(program, [
                                "included_in_membership",
                                "booking_opens_days",
                                "booking_closes_minutes",
                                "cancel_window_minutes",
                                "late_cancel_fee_cents",
                                "no_show_fee_cents",
                              ])}
                              edited={program.edited}
                              triggerLabel={`Edit ${program.name}`}
                              compact
                            />
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="rooms">
            <Card className="py-0">
              <CardHeader className="pt-6">
                <CardTitle>Rooms</CardTitle>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room</TableHead>
                    <TableHead className="text-right">Classes a week</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rooms.map((room) => (
                    <TableRow key={room.id} className={room.active === false ? "text-muted-foreground" : undefined}>
                      <TableCell className="font-medium">
                        {room.name as string} {room.active === false ? <Badge variant="outline">Not in use</Badge> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{roomUse.get(room.mindbody_resource_id) ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1">
                          <Edited show={room.edited.length > 0} />
                          <CatalogEditDialog
                            entity="room"
                            id={room.id}
                            title={room.name as string}
                            values={pick(room, ["name", "active"])}
                            edited={room.edited}
                            triggerLabel={`Edit ${room.name}`}
                            compact
                          />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="widget">
            <WidgetTab siteUrl={siteUrl} siteId={(org?.mindbody_site_id as number | null) ?? null} />
          </TabsContent>

          <TabsContent value="appointments">
            <Card className="py-0">
              <CardHeader className="pt-6">
                <CardTitle>Appointment types</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Program</TableHead>
                      <TableHead className="text-right">Length</TableHead>
                      <TableHead>Bookable online</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionTypes
                      .filter((type) => type.kind === "Appointment")
                      .map((type) => (
                        <TableRow key={type.id}>
                          <TableCell className="font-medium">{type.name as string}</TableCell>
                          <TableCell>{type.mindbody_program_id ? (programName.get(type.mindbody_program_id) ?? "—") : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {type.default_minutes ? `${type.default_minutes} min` : "—"}
                          </TableCell>
                          <TableCell>{type.available_online ? "Yes" : "Staff only"}</TableCell>
                          <TableCell className="text-right">
                            <span className="inline-flex items-center gap-1">
                              <Edited show={type.edited.length > 0} />
                              <CatalogEditDialog
                                entity="session_type"
                                id={type.id}
                                title={type.name as string}
                                values={pick(type, ["name", "default_minutes", "available_online", "online_description"])}
                                edited={type.edited}
                                triggerLabel={`Edit ${type.name}`}
                                compact
                              />
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}
