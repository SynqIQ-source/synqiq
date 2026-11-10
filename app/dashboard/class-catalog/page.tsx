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

// The class catalog as SynqIQ holds it (imported from Mindbody nightly):
// class types and descriptions, the weekly schedule, rooms, programs with
// their booking rules, appointment types. Read-only for now; editing comes
// next. Club Admins only.

type ClassType = {
  id: string;
  mindbody_class_description_id: number;
  name: string;
  description_text: string | null;
  level: string | null;
  category: string | null;
  subcategory: string | null;
  mindbody_program_id: number | null;
  active: boolean;
  image_url: string | null;
};
type Schedule = {
  id: string;
  mindbody_class_description_id: number | null;
  class_name: string | null;
  days: number[];
  start_time: string | null;
  end_time: string | null;
  staff_mindbody_id: number | null;
  mindbody_resource_id: number | null;
  capacity: number | null;
  last_class_at: string | null;
};
type Program = {
  id: string;
  mindbody_program_id: number;
  name: string;
  schedule_type: string | null;
  cancel_window_minutes: number | null;
  booking_opens_days: number | null;
  booking_closes_minutes: number | null;
  paid_by: { id: number; name: string | null }[];
};
type Room = { id: string; mindbody_resource_id: number; name: string };
type SessionType = {
  id: string;
  name: string;
  kind: string | null;
  default_minutes: number | null;
  mindbody_program_id: number | null;
  available_online: boolean | null;
};

const time = (value: string | null) => (value ? DateTime.fromFormat(value.slice(0, 5), "HH:mm").toFormat("h:mm a") : "—");
const minutes = (value: number | null) => {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "none";
  if (value % 1440 === 0) return `${value / 1440} day${value === 1440 ? "" : "s"}`;
  if (value % 60 === 0) return `${value / 60} hr`;
  return `${value} min`;
};

export default async function ClassCatalogPage() {
  const staff = await requireAccess(isClubAdmin);
  const supabase = await getScopedClient(staff);
  const orgId = staff.organizationId;
  const [{ data: classTypes }, { data: schedules }, { data: programs }, { data: rooms }, { data: sessionTypes }] = await Promise.all([
    supabase
      .from("class_types")
      .select(
        "id, mindbody_class_description_id, name, description_text, level, category, subcategory, mindbody_program_id, active, image_url",
      )
      .eq("organization_id", orgId)
      .order("name")
      .returns<ClassType[]>(),
    supabase
      .from("class_schedules")
      .select(
        "id, mindbody_class_description_id, class_name, days, start_time, end_time, staff_mindbody_id, mindbody_resource_id, capacity, last_class_at",
      )
      .eq("organization_id", orgId)
      .order("start_time")
      .returns<Schedule[]>(),
    supabase
      .from("departments")
      .select("id, mindbody_program_id, name, schedule_type, cancel_window_minutes, booking_opens_days, booking_closes_minutes, paid_by")
      .eq("organization_id", orgId)
      .not("synced_at", "is", null)
      .order("name")
      .returns<Program[]>(),
    supabase.from("rooms").select("id, mindbody_resource_id, name").eq("organization_id", orgId).order("name").returns<Room[]>(),
    supabase
      .from("session_types")
      .select("id, name, kind, default_minutes, mindbody_program_id, available_online")
      .eq("organization_id", orgId)
      .order("name")
      .returns<SessionType[]>(),
  ]);

  // A schedule is running if it had a class in the last 30 days.
  const cutoff = DateTime.now().minus({ days: 30 }).toISO()!;
  const running = (schedules ?? []).filter((schedule) => schedule.last_class_at && schedule.last_class_at >= cutoff);
  const programName = new Map((programs ?? []).map((program) => [program.mindbody_program_id, program.name]));
  const roomName = new Map((rooms ?? []).map((room) => [room.mindbody_resource_id, room.name]));
  const staffIds = [...new Set(running.map((schedule) => schedule.staff_mindbody_id).filter((id): id is number => typeof id === "number"))];
  const { data: staffRows } = staffIds.length
    ? await supabase.from("staff").select("mindbody_staff_id, display_name").eq("organization_id", orgId).in("mindbody_staff_id", staffIds)
    : { data: [] as { mindbody_staff_id: number; display_name: string }[] };
  const staffName = new Map((staffRows ?? []).map((row) => [Number(row.mindbody_staff_id), row.display_name as string]));

  const isPool = (schedule: Schedule) => /pool lane/i.test(schedule.class_name ?? "");
  const poolSlots = running.filter(isPool);
  const classSlots = running.filter((schedule) => !isPool(schedule));
  const weeklyByType = new Map<number, number>();
  for (const schedule of running) {
    if (schedule.mindbody_class_description_id)
      weeklyByType.set(
        schedule.mindbody_class_description_id,
        (weeklyByType.get(schedule.mindbody_class_description_id) ?? 0) + schedule.days.length,
      );
  }
  const offered = (classTypes ?? []).filter((type) => weeklyByType.has(type.mindbody_class_description_id));
  const notOffered = (classTypes ?? []).filter((type) => !weeklyByType.has(type.mindbody_class_description_id) && type.active);
  const roomUse = new Map<number, number>();
  for (const schedule of running)
    if (schedule.mindbody_resource_id)
      roomUse.set(schedule.mindbody_resource_id, (roomUse.get(schedule.mindbody_resource_id) ?? 0) + schedule.days.length);

  return (
    <DashboardShell
      title="Class Catalog"
      description="Classes, schedules, rooms and booking rules, imported from Mindbody each night. Editing in SynqIQ comes next; Mindbody still runs booking until the switch."
    >
      <div className="space-y-6">
        <Card className="py-4">
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Class types offered" value={offered.length} />
            <Stat label="Classes a week" value={classSlots.reduce((sum, schedule) => sum + schedule.days.length, 0)} />
            <Stat label="Pool lane slots a week" value={poolSlots.reduce((sum, schedule) => sum + schedule.days.length, 0)} />
            <Stat label="Rooms" value={(rooms ?? []).length} />
            <Stat label="Appointment types" value={(sessionTypes ?? []).filter((type) => type.kind === "Appointment").length} />
          </CardContent>
        </Card>
        {(schedules ?? []).length ? null : <p className="text-sm text-muted-foreground">Not imported yet.</p>}

        <Tabs defaultValue="schedule">
          <TabsList className="flex-wrap">
            <TabsTrigger value="schedule">Weekly schedule</TabsTrigger>
            <TabsTrigger value="types">Class types</TabsTrigger>
            <TabsTrigger value="rules">Booking rules</TabsTrigger>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            <TabsTrigger value="appointments">Appointment types</TabsTrigger>
          </TabsList>

          <TabsContent value="schedule" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const slots = classSlots
                  .filter((schedule) => schedule.days.includes(day))
                  .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
                return (
                  <Card key={day} className="gap-2 py-4">
                    <CardHeader className="px-4">
                      <CardTitle className="text-base">
                        {DAY_NAMES[day]} <span className="text-sm font-normal text-muted-foreground">· {slots.length} classes</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 px-4">
                      {slots.map((schedule) => (
                        <div key={schedule.id} className="rounded-md border px-2 py-1.5 text-sm">
                          <p className="font-medium">{schedule.class_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {time(schedule.start_time)}–{time(schedule.end_time)}
                            {schedule.mindbody_resource_id ? ` · ${roomName.get(schedule.mindbody_resource_id) ?? "Room"}` : ""}
                            {schedule.capacity ? ` · ${schedule.capacity} spots` : ""}
                          </p>
                          {schedule.staff_mindbody_id && staffName.get(schedule.staff_mindbody_id) ? (
                            <p className="text-xs text-muted-foreground">{staffName.get(schedule.staff_mindbody_id)}</p>
                          ) : null}
                        </div>
                      ))}
                      {slots.length === 0 ? <p className="text-sm text-muted-foreground">No classes.</p> : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">
              Pool lanes: {poolSlots.length} lane-slots ({poolSlots.reduce((sum, schedule) => sum + schedule.days.length, 0)} a week), 2
              swimmers each. Schedules shown are ones with a class in the last 30 days.
            </p>
          </TabsContent>

          <TabsContent value="types" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {offered.map((type) => (
                <Card key={type.id} className="gap-2 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="text-base">{type.name}</CardTitle>
                    <CardDescription className="flex flex-wrap gap-1">
                      {type.mindbody_program_id ? (
                        <Badge variant="secondary">{programName.get(type.mindbody_program_id) ?? "Program"}</Badge>
                      ) : null}
                      {type.category ? <Badge variant="outline">{type.category}</Badge> : null}
                      {type.subcategory ? <Badge variant="outline">{type.subcategory}</Badge> : null}
                      {type.level ? <Badge variant="outline">{type.level}</Badge> : null}
                      <Badge variant="outline">{weeklyByType.get(type.mindbody_class_description_id)} a week</Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-4">
                    <p className="text-sm whitespace-pre-line text-muted-foreground">{type.description_text ?? "No description."}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            {notOffered.length ? (
              <p className="text-sm text-muted-foreground">
                Active in Mindbody but not on the current schedule: {notOffered.map((type) => type.name).join(", ")}.
              </p>
            ) : null}
          </TabsContent>

          <TabsContent value="rules">
            <Card className="py-0">
              <CardHeader className="pt-6">
                <CardTitle>Booking rules by program</CardTitle>
                <CardDescription>
                  From Mindbody&apos;s programs. Late cancel = cancelling inside this window counts as late.
                </CardDescription>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Program</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Booking opens</TableHead>
                      <TableHead>Online booking closes</TableHead>
                      <TableHead>Late-cancel window</TableHead>
                      <TableHead>Paid by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(programs ?? [])
                      .filter((program) => program.schedule_type === "Class" || program.schedule_type === "Appointment")
                      .map((program) => (
                        <TableRow key={program.id}>
                          <TableCell className="font-medium">{program.name}</TableCell>
                          <TableCell>{program.schedule_type}</TableCell>
                          <TableCell>{program.booking_opens_days ? `${program.booking_opens_days} days ahead` : "—"}</TableCell>
                          <TableCell>
                            {program.schedule_type === "Appointment"
                              ? program.booking_closes_minutes
                                ? `${minutes(program.booking_closes_minutes)} notice`
                                : "—"
                              : program.booking_closes_minutes
                                ? `${minutes(program.booking_closes_minutes)} before`
                                : "—"}
                          </TableCell>
                          <TableCell>{minutes(program.cancel_window_minutes)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {program.paid_by.length ? program.paid_by.map((item) => item.name).join(", ") : "—"}
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rooms ?? []).map((room) => (
                    <TableRow key={room.id}>
                      <TableCell className="font-medium">{room.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{roomUse.get(room.mindbody_resource_id) ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="appointments">
            <Card className="py-0">
              <CardHeader className="pt-6">
                <CardTitle>Appointment and session types</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Program</TableHead>
                      <TableHead className="text-right">Length</TableHead>
                      <TableHead>Bookable online</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(sessionTypes ?? [])
                      .filter((type) => type.kind === "Appointment")
                      .map((type) => (
                        <TableRow key={type.id}>
                          <TableCell className="font-medium">{type.name}</TableCell>
                          <TableCell>{type.mindbody_program_id ? (programName.get(type.mindbody_program_id) ?? "—") : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {type.default_minutes ? `${type.default_minutes} min` : "—"}
                          </TableCell>
                          <TableCell>{type.available_online ? "Yes" : "Staff only"}</TableCell>
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
