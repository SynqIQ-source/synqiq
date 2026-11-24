import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { CatalogEditDialog } from "./edit-dialog";
import { RoomLayoutEditor, type SavedLayout } from "./room-layout-editor";
import { parseLayout } from "@/lib/rooms/layout";
import { WidgetTab } from "./widget-tab";
import { CalendarTab, type SessionRow } from "./calendar-tab";
import { CALENDAR_DAYS } from "@/lib/sync/class-calendar";
import type { MindbodyClass } from "@/lib/classes/calendar";
import { cancelKey } from "@/lib/classes/cancelled-sessions";

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
  required_item_id: string | null;
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
        "id, source, mindbody_class_description_id, name, description_text, level, category, subcategory, mindbody_program_id, active, image_url, edits",
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
      .select(
        "id, mindbody_program_id, name, schedule_type, cancel_window_minutes, booking_opens_days, booking_closes_minutes, required_item_id, active, edits",
      )
      .eq("organization_id", orgId)
      // Mindbody's categories, and ones made in SynqIQ (negative program ids),
      // the same list as Services & Pricing > Classes.
      .or("synced_at.not.is.null,mindbody_program_id.lt.0")
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
  const { data: layoutRows } = await supabase
    .from("room_layouts")
    .select("id, room_id, name, is_default, class_type_ids, columns, rows, items, spot_noun")
    .eq("organization_id", staff.organizationId)
    .order("is_default", { ascending: false })
    .order("name");
  // Each room's layouts: the main one first, then per-class ones.
  const layoutsByRoom = new Map<string, SavedLayout[]>();
  for (const row of layoutRows ?? []) {
    const layout = parseLayout(row);
    if (!layout) continue;
    const list = layoutsByRoom.get(row.room_id as string) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      isDefault: Boolean(row.is_default),
      classTypeIds: (row.class_type_ids as string[] | null) ?? [],
      layout,
    });
    layoutsByRoom.set(row.room_id as string, list);
  }
  const sessionTypes = (sessionRows ?? []).map((row) => effective("session_type", row));
  // A schedule is running if it had a class in the last 30 days and hasn't
  // been taken off the schedule in SynqIQ.
  const cutoff = DateTime.now().minus({ days: 30 }).toISO()!;
  const allRunning = (scheduleRows ?? [])
    .filter((row) => row.source === "synqiq" || (row.last_class_at && Date.parse(row.last_class_at) >= Date.parse(cutoff)))
    .map((row) => effective("class_schedule", row));
  const running = allRunning.filter((schedule) => schedule.active !== false);

  const programName = new Map(programs.map((program) => [program.mindbody_program_id, program.name as string]));
  const roomName = new Map(rooms.map((room) => [room.mindbody_resource_id, room.name as string]));
  const typeNameById = new Map(classTypes.map((type) => [type.id, type.name as string]));
  const staffName = new Map((teacherRows ?? []).map((row) => [Number(row.mindbody_staff_id), row.display_name as string]));
  const roomOptions = rooms
    .filter((room) => room.active !== false)
    .map((room) => ({ value: room.mindbody_resource_id, label: room.name as string }));
  const instructorOptions = (teacherRows ?? [])
    .filter((row) => row.is_instructor)
    .map((row) => ({ value: Number(row.mindbody_staff_id), label: row.display_name as string }));

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
  // Class types that run in each room (listed first when assigning a layout).
  const typesInRoom = new Map<number, Set<string>>();
  for (const schedule of running) {
    const room = schedule.mindbody_resource_id as number | null;
    if (!room || !schedule.class_type_id) continue;
    const set = typesInRoom.get(room) ?? new Set<string>();
    set.add(schedule.class_type_id as string);
    typesInRoom.set(room, set);
  }
  const typeOptionsFor = (room: number) =>
    offered
      .map((type) => ({ id: type.id, name: type.name as string, inRoom: Boolean(typesInRoom.get(room)?.has(type.id)) }))
      .sort((a, b) => Number(b.inRoom) - Number(a.inRoom) || a.name.localeCompare(b.name));
  const roomUse = new Map<number, number>();
  for (const schedule of running) {
    const room = schedule.mindbody_resource_id as number | null;
    if (room) roomUse.set(room, (roomUse.get(room) ?? 0) + days(schedule).length);
  }

  // SynqIQ's calendar and Mindbody's classes over the same dates.
  const { data: org } = await supabase
    .from("organizations")
    .select("timezone, mindbody_site_id, member_portal_mode")
    .eq("id", orgId)
    .maybeSingle();
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
      .select("mindbody_class_schedule_id, start_datetime, staff_id, is_canceled")
      .eq("organization_id", orgId)
      .gte("start_datetime", today.startOf("day").toUTC().toISO()!)
      .lte("start_datetime", windowEnd.endOf("day").toUTC().toISO()!)
      .limit(5000),
    supabase.from("staff").select("id, mindbody_staff_id").eq("organization_id", orgId).not("mindbody_staff_id", "is", null),
  ]);
  const mindbodyStaffById = new Map((staffIdRows ?? []).map((row) => [row.id as string, Number(row.mindbody_staff_id)]));
  const mindbodyByDate = new Map<string, MindbodyClass[]>();
  // Cancelled in Mindbody: not shown on the calendar at all.
  const cancelledKeys = new Set(
    (mindbodyRows ?? []).filter((row) => row.is_canceled).map((row) => cancelKey(row.mindbody_class_schedule_id, row.start_datetime)),
  );
  const shownSessions = (calendarRows ?? []).filter(
    (row) => !row.mindbody_class_schedule_id || !cancelledKeys.has(cancelKey(row.mindbody_class_schedule_id, row.starts_at)),
  );
  for (const row of mindbodyRows ?? []) {
    if (row.is_canceled) continue;
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

  return (
    <DashboardShell
      title="Class Catalog"
      description="The day-by-day class calendar, rooms and layouts, appointment types and the website widget. Imported from Mindbody each night; edits made in SynqIQ win and are kept."
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

        <p className="text-sm">
          Classes, class times and booking rules are set up and changed on{" "}
          <Link href="/dashboard/services/classes" className="underline">
            Services &amp; Pricing &gt; Classes
          </Link>
          . This page is the day-by-day calendar, rooms, appointment types and the website widget.
        </p>

        <Tabs defaultValue="calendar">
          <TabsList className="flex-wrap">
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            <TabsTrigger value="appointments">Appointment types</TabsTrigger>
            <TabsTrigger value="widget">Website widget</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar">
            <CalendarTab
              sessions={shownSessions}
              mindbodyByDate={mindbodyByDate}
              roomName={roomName}
              staffName={staffName}
              rooms={roomOptions}
              instructors={instructorOptions}
              timezone={timezone}
            />
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
                        {(layoutsByRoom.get(room.id) ?? [])
                          .filter((record) => !record.isDefault)
                          .map((record) => (
                            <span key={record.id} className="block text-xs font-normal text-muted-foreground">
                              {record.name}: {record.classTypeIds.map((id) => typeNameById.get(id) ?? "class").join(", ")}
                            </span>
                          ))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{roomUse.get(room.mindbody_resource_id) ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1">
                          {(layoutsByRoom.get(room.id) ?? []).map((record) => (
                            <RoomLayoutEditor
                              key={record.id}
                              roomId={room.id}
                              roomName={room.name as string}
                              record={record}
                              classTypes={typeOptionsFor(room.mindbody_resource_id as number)}
                              hasMain={(layoutsByRoom.get(room.id) ?? []).some((other) => other.isDefault && other.id !== record.id)}
                            />
                          ))}
                          <RoomLayoutEditor
                            roomId={room.id}
                            roomName={room.name as string}
                            record={null}
                            classTypes={typeOptionsFor(room.mindbody_resource_id as number)}
                            hasMain={(layoutsByRoom.get(room.id) ?? []).some((other) => other.isDefault)}
                          />
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
            <WidgetTab
              siteUrl={siteUrl}
              siteId={(org?.mindbody_site_id as number | null) ?? null}
              portalMode={(org?.member_portal_mode as string | null) ?? "off"}
            />
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
