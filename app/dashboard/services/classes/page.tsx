import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CATALOG_FIELDS, effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import { loadIncludedSetup } from "@/lib/coverage/included";
import { CatalogEditDialog } from "../../class-catalog/edit-dialog";
import { CatalogCreateDialog } from "../../class-catalog/create-dialog";
import { DAY_NAMES } from "@/lib/classes/catalog";
import { EndSeriesDialog, ScheduleEditorDialog, type ExistingSeries, type RoomOption, type StaffOption } from "./schedule-editor";
import { NewCategoryDialog } from "./new-category";

export const metadata: Metadata = { title: "Classes" };
export const dynamic = "force-dynamic";

// Services & Pricing > Classes (Club Admins), laid out like Mindbody's:
// one card per class category with its classes, what pays for them, and its
// booking rules. Add a class to a category, or a class time to a class.
// Classes always follow their category's coverage.

type Edits = { edits: Record<string, CatalogValue> | null };
const pick = (row: Record<string, unknown>, fields: string[]) =>
  Object.fromEntries(fields.map((field) => [field, (row[field] ?? null) as CatalogValue]));
const money = (cents: unknown) => (typeof cents === "number" ? `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}` : "—");
const mins = (value: unknown) => {
  if (typeof value !== "number") return "—";
  if (value === 0) return "none";
  if (value % 1440 === 0) return `${value / 1440} day${value === 1440 ? "" : "s"}`;
  if (value % 60 === 0) return `${value / 60} hr`;
  return `${value} min`;
};

export default async function ClassesPage() {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const { data: orgRow } = await admin.from("organizations").select("timezone").eq("id", org).maybeSingle();
  const timezone = (orgRow?.timezone as string | null) ?? "America/Chicago";
  const now = DateTime.now().setZone(timezone);
  const today = now.toISODate()!;

  const [
    setup,
    { data: itemRows },
    { data: programRows },
    { data: typeRows },
    { data: scheduleRows },
    { data: sessionRows },
    { data: roomRows },
    { data: teacherRows },
    { data: serviceRows },
    { data: posRows },
  ] = await Promise.all([
    loadIncludedSetup(admin, org),
    admin.from("included_items").select("id, name, active").eq("organization_id", org).order("sort").order("name"),
    admin
      .from("departments")
      .select(
        "id, mindbody_program_id, name, schedule_type, active, synced_at, cancel_window_minutes, booking_opens_days, booking_closes_minutes, required_item_id, edits",
      )
      .eq("organization_id", org)
      .order("name"),
    admin
      .from("class_types")
      .select("id, source, name, description_text, level, category, prerequisites, notes, mindbody_program_id, active, edits")
      .eq("organization_id", org)
      .order("name"),
    admin
      .from("class_schedules")
      .select(
        "id, source, class_type_id, days, start_time, end_time, start_date, end_date, frequency_type, frequency_interval, last_class_at, staff_mindbody_id, mindbody_resource_id, capacity, staff_id, assistant_staff_id, room_id, layout_id, pay_override_cents, assistant_pay_cents, waitlist_capacity, online_capacity, is_free, pay_later, edits",
      )
      .eq("organization_id", org),
    admin
      .from("class_sessions")
      .select("class_type_id, starts_at")
      .eq("organization_id", org)
      .gte("starts_at", now.toUTC().toISO()!)
      .is("removed_from_schedule_at", null)
      .order("starts_at")
      .limit(5000),
    admin.from("rooms").select("id, mindbody_resource_id, name, active, edits").eq("organization_id", org).order("name"),
    admin.from("staff").select("id, mindbody_staff_id, display_name, is_instructor").eq("organization_id", org).order("display_name"),
    admin
      .from("member_services")
      .select("product_id, name, program")
      .eq("organization_id", org)
      .eq("is_current", true)
      .not("product_id", "is", null),
    admin
      .from("pos_items")
      .select("id, mindbody_id, name, price_cents, members_only, active, kind")
      .eq("organization_id", org)
      .is("deleted_at", null),
  ]);

  const items = (itemRows ?? []).filter((row) => row.active).map((row) => ({ id: row.id as string, name: row.name as string }));
  const itemName = new Map((itemRows ?? []).map((row) => [row.id as string, row.name as string]));
  const rooms = (roomRows ?? []).map((row) => effective("room", row as Record<string, unknown> & Edits));
  const roomOptions = rooms
    .filter((room) => room.active !== false)
    .map((room) => ({ value: Number(room.mindbody_resource_id), label: room.name as string }));
  // The schedule editor links staff and rooms by SynqIQ id.
  const staffChoices: StaffOption[] = (teacherRows ?? [])
    .filter((row) => row.is_instructor)
    .map((row) => ({ id: row.id as string, name: row.display_name as string }));
  const staffName = new Map((teacherRows ?? []).map((row) => [row.id as string, row.display_name as string]));
  const staffByMindbody = new Map(
    (teacherRows ?? []).filter((row) => row.mindbody_staff_id).map((row) => [Number(row.mindbody_staff_id), row.id as string]),
  );
  const { data: layoutRows } = await admin
    .from("room_layouts")
    .select("id, room_id, name, is_default, active")
    .eq("organization_id", org)
    .order("name");
  const roomChoices: RoomOption[] = rooms
    .filter((room) => room.active !== false)
    .map((room) => ({
      id: room.id as string,
      name: room.name as string,
      layouts: (layoutRows ?? [])
        .filter((layout) => layout.room_id === room.id && layout.active !== false)
        .map((layout) => ({ id: layout.id as string, name: layout.name as string, isDefault: Boolean(layout.is_default) })),
    }));
  const roomName = new Map(rooms.map((room) => [room.id as string, room.name as string]));
  const roomByMindbody = new Map(rooms.map((room) => [Number(room.mindbody_resource_id), room.id as string]));

  // Classes a week and next date, per class.
  const cutoff = now.minus({ days: 30 }).toMillis();
  const weekly = new Map<string, number>();
  const seriesByType = new Map<string, Record<string, unknown>[]>();
  for (const raw of scheduleRows ?? []) {
    const schedule = effective("class_schedule", raw as Record<string, unknown> & Edits);
    if (!schedule.class_type_id || schedule.active === false) continue;
    if (schedule.end_date && (schedule.end_date as string) < today) continue;
    if (schedule.source !== "synqiq" && !(schedule.last_class_at && Date.parse(schedule.last_class_at as string) >= cutoff)) continue;
    seriesByType.set(schedule.class_type_id as string, [...(seriesByType.get(schedule.class_type_id as string) ?? []), schedule]);
    weekly.set(
      schedule.class_type_id as string,
      (weekly.get(schedule.class_type_id as string) ?? 0) + ((schedule.days as number[]) ?? []).length,
    );
  }
  const nextClass = new Map<string, string>();
  for (const row of sessionRows ?? []) {
    if (row.class_type_id && !nextClass.has(row.class_type_id as string))
      nextClass.set(row.class_type_id as string, row.starts_at as string);
  }

  // Pricing options members hold, by category (Mindbody's program), with our price.
  const posByMindbody = new Map((posRows ?? []).filter((row) => row.mindbody_id).map((row) => [String(row.mindbody_id), row]));
  const heldByProgram = new Map<string, Map<string, { name: string; holders: number }>>();
  for (const row of serviceRows ?? []) {
    const program = (row.program as string | null) ?? "";
    const list = heldByProgram.get(program) ?? new Map();
    const key = String(row.product_id);
    const current = list.get(key);
    if (current) current.holders += 1;
    else list.set(key, { name: row.name as string, holders: 1 });
    heldByProgram.set(program, list);
  }
  const productsIncluding = (itemId: string | null) => {
    if (!itemId) return [] as string[];
    return Object.entries(setup.grants)
      .filter(([, ids]) => ids.includes(itemId))
      .map(([productId]) => productId);
  };
  const posIncluding = (itemId: string | null) =>
    itemId ? (posRows ?? []).filter((row) => row.active !== false && (setup.posGrants[row.id as string] ?? []).includes(itemId)) : [];
  const productName = new Map<string, string>();
  for (const row of serviceRows ?? []) productName.set(String(row.product_id), row.name as string);

  const types = (typeRows ?? []).map((row) => effective("class_type", row as Record<string, unknown> & Edits));
  const categories = (programRows ?? [])
    .filter((row) => row.schedule_type === "Class" && row.active !== false && (row.synced_at || (row.mindbody_program_id as number) < 0))
    .map((row) => effective("program", row as Record<string, unknown> & Edits));
  const classTypeFields = Object.keys(CATALOG_FIELDS.class_type);
  const defaultsFor = (type: Record<string, unknown>) => ({
    minutes: (type.default_minutes as number | null) ?? null,
    roomId: type.default_room ? (roomByMindbody.get(Number(type.default_room)) ?? null) : null,
    capacity: (type.default_capacity as number | null) ?? null,
    waitlist: (type.waitlist_capacity as number | null) ?? null,
    online: (type.online_capacity as number | null) ?? null,
  });
  const clock = (value: unknown) => (typeof value === "string" ? DateTime.fromFormat(value.slice(0, 5), "HH:mm").toFormat("h:mm a") : "—");
  // One class time (series): when, who, where; SynqIQ's can be changed or ended.
  const seriesLine = (series: Record<string, unknown>, type: Record<string, unknown>) => {
    const staffId =
      (series.staff_id as string | null) ??
      (series.staff_mindbody_id ? (staffByMindbody.get(Number(series.staff_mindbody_id)) ?? null) : null);
    const roomId =
      (series.room_id as string | null) ??
      (series.mindbody_resource_id ? (roomByMindbody.get(Number(series.mindbody_resource_id)) ?? null) : null);
    const every = Number(series.frequency_interval ?? 1) || 1;
    const days = ((series.days as number[]) ?? []).map((day) => DAY_NAMES[day]).join(", ");
    const existing: ExistingSeries = {
      scheduleId: series.id as string,
      days: (series.days as number[]) ?? [],
      startTime: String(series.start_time ?? ""),
      endTime: String(series.end_time ?? ""),
      everyWeeks: every,
      staffId,
      assistantId: (series.assistant_staff_id as string | null) ?? null,
      payCents: (series.pay_override_cents as number | null) ?? null,
      assistantPayCents: (series.assistant_pay_cents as number | null) ?? null,
      roomId,
      layoutId: (series.layout_id as string | null) ?? null,
      capacity: (series.capacity as number | null) ?? null,
      waitlist: (series.waitlist_capacity as number | null) ?? null,
      online: (series.online_capacity as number | null) ?? null,
      isFree: series.is_free === true,
      payLater: series.pay_later === true,
      endDate: (series.end_date as string | null) ?? null,
    };
    return (
      <li key={series.id as string} className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground">
          {series.frequency_type === "Single" ? DateTime.fromISO(series.start_date as string).toFormat("ccc LLL d") : days}
          {every > 1 ? ` (every ${every} weeks)` : ""} · {clock(series.start_time)}–{clock(series.end_time)}
          {staffId ? ` · ${staffName.get(staffId) ?? "Instructor"}` : ""}
          {series.assistant_staff_id ? ` + ${staffName.get(series.assistant_staff_id as string) ?? "assistant"}` : ""}
          {roomId ? ` · ${roomName.get(roomId) ?? "Room"}` : ""}
          {series.end_date ? ` · until ${DateTime.fromISO(series.end_date as string).toFormat("LLL d, yyyy")}` : ""}
          {series.source === "synqiq" ? "" : " · from Mindbody"}
        </span>
        {series.source === "synqiq" ? (
          <span className="flex gap-1">
            <ScheduleEditorDialog
              classTypeId={type.id as string}
              className={type.name as string}
              today={today}
              instructors={staffChoices}
              rooms={roomChoices}
              defaults={defaultsFor(type)}
              series={existing}
            />
            <EndSeriesDialog scheduleId={series.id as string} label={type.name as string} today={today} />
          </span>
        ) : null}
      </li>
    );
  };
  const programFields = Object.keys(CATALOG_FIELDS.program);

  return (
    <DashboardShell
      title="Classes"
      description="Each class category, its classes, what pays for them, and its booking rules. Add a class to a category, or a class time to a class."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <NewCategoryDialog items={items} />
          <Link href="/dashboard/services/included" className="text-sm underline">
            What&apos;s Included
          </Link>
          <Link href="/dashboard/class-catalog" className="text-sm underline">
            Weekly schedule &amp; calendar
          </Link>
        </div>

        {categories.map((category) => {
          const inCategory = types.filter((type) => type.mindbody_program_id === category.mindbody_program_id);
          const scheduled = inCategory.filter((type) => weekly.has(type.id as string));
          const unscheduled = inCategory.filter((type) => !weekly.has(type.id as string) && type.active !== false);
          const needs = (category.required_item_id as string | null) ?? null;
          const membershipsCover = needs ? setup.membershipDefaults.includes(needs) : category.included_in_membership !== false;
          const tieredMemberships = productsIncluding(needs);
          const held = [...(heldByProgram.get(category.name as string)?.values() ?? [])].sort((a, b) => b.holders - a.holders);
          const heldIds = [...(heldByProgram.get(category.name as string)?.keys() ?? [])];
          const sellable = [
            ...heldIds.map((id) => posByMindbody.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row)),
            ...posIncluding(needs),
          ].filter((row, index, list) => list.findIndex((other) => other.id === row.id) === index);

          const classRow = (type: (typeof types)[number]) => (
            <div key={type.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{type.name as string}</span>
                {type.source === "synqiq" ? (
                  <Badge variant="secondary" className="ml-2">
                    SynqIQ
                  </Badge>
                ) : null}
                <span className="block text-xs text-muted-foreground">
                  {weekly.get(type.id as string) ? `${weekly.get(type.id as string)} a week` : "Not scheduled"}
                  {nextClass.get(type.id as string)
                    ? ` · next ${DateTime.fromISO(nextClass.get(type.id as string)!)
                        .setZone(timezone)
                        .toFormat("ccc LLL d, h:mm a")}`
                    : ""}
                  {type.level ? ` · ${type.level}` : ""}
                </span>
              </div>
              <div className="flex gap-1">
                <CatalogEditDialog
                  entity="class_type"
                  id={type.id as string}
                  title={type.name as string}
                  values={pick(type, classTypeFields)}
                  edited={type.edited}
                  rooms={roomOptions}
                  compact
                />
                <ScheduleEditorDialog
                  classTypeId={type.id as string}
                  className={type.name as string}
                  today={today}
                  instructors={staffChoices}
                  rooms={roomChoices}
                  defaults={defaultsFor(type)}
                />
              </div>
              {seriesByType.get(type.id as string)?.length ? (
                <ul className="w-full space-y-1 border-l pl-3 text-xs">
                  {seriesByType
                    .get(type.id as string)!
                    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
                    .map((series) => seriesLine(series, type))}
                </ul>
              ) : null}
            </div>
          );

          return (
            <Card key={category.id as string}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{category.name as string}</CardTitle>
                  <CardDescription>
                    {scheduled.length} scheduled class{scheduled.length === 1 ? "" : "es"} · needs {needs ? itemName.get(needs) : "—"}
                    {membershipsCover ? " (memberships cover it)" : ""}
                  </CardDescription>
                </div>
                <CatalogCreateDialog
                  entity="class_type"
                  label="Add class"
                  today={today}
                  triggerVariant="outline"
                  programs={[{ value: category.mindbody_program_id as number, label: category.name as string }]}
                  rooms={roomOptions}
                  initial={{ mindbody_program_id: category.mindbody_program_id as number }}
                />
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="classes">
                  <TabsList>
                    <TabsTrigger value="classes">Classes</TabsTrigger>
                    <TabsTrigger value="pricing">Pricing &amp; coverage</TabsTrigger>
                    <TabsTrigger value="rules">Booking rules</TabsTrigger>
                  </TabsList>
                  <TabsContent value="classes" className="mt-3">
                    <div className="divide-y rounded-md border">
                      {scheduled.length ? (
                        scheduled.map(classRow)
                      ) : (
                        <p className="px-4 py-3 text-sm text-muted-foreground">No classes scheduled.</p>
                      )}
                    </div>
                    {unscheduled.length ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm text-muted-foreground">
                          {unscheduled.length} class{unscheduled.length === 1 ? "" : "es"} not on the schedule
                        </summary>
                        <div className="mt-2 divide-y rounded-md border">{unscheduled.map(classRow)}</div>
                      </details>
                    ) : null}
                  </TabsContent>
                  <TabsContent value="pricing" className="mt-3 space-y-3 text-sm">
                    <p>
                      Members need <span className="font-medium">{needs ? itemName.get(needs) : "—"}</span> to book.{" "}
                      <Link href="/dashboard/services/included" className="underline">
                        Change on What&apos;s Included
                      </Link>
                    </p>
                    <div>
                      <p className="font-medium">Covered by</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                        {membershipsCover ? <li>Every membership</li> : null}
                        {tieredMemberships.map((id) => (
                          <li key={id}>{productName.get(id) ?? `Pricing option ${id}`}</li>
                        ))}
                        {held.length ? <li>Packs and passes in {category.name as string} (below)</li> : null}
                        {!membershipsCover && !tieredMemberships.length && !held.length ? <li>Nothing yet</li> : null}
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">Packs and passes</p>
                      {held.length || sellable.length ? (
                        <div className="mt-1 divide-y rounded-md border">
                          {sellable.map((row) => (
                            <div key={row.id as string} className="flex justify-between gap-2 px-3 py-1.5">
                              <span>
                                {row.name as string}
                                {row.members_only ? <span className="ml-2 text-xs text-muted-foreground">members only</span> : null}
                              </span>
                              <span className="tabular-nums">{money(row.price_cents)}</span>
                            </div>
                          ))}
                          {held
                            .filter((option) => !sellable.some((row) => row.name === option.name))
                            .map((option) => (
                              <div key={option.name} className="flex justify-between gap-2 px-3 py-1.5 text-muted-foreground">
                                <span>{option.name}</span>
                                <span>{option.holders} hold it</span>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground">None.</p>
                      )}
                      <Link href="/dashboard/services/packs" className="mt-2 inline-block underline">
                        Add pricing
                      </Link>
                    </div>
                  </TabsContent>
                  <TabsContent value="rules" className="mt-3 space-y-3 text-sm">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                      <dt className="text-muted-foreground">Booking opens</dt>
                      <dd className="sm:col-span-2">
                        {typeof category.booking_opens_days === "number" ? `${category.booking_opens_days} days ahead` : "—"}
                      </dd>
                      <dt className="text-muted-foreground">Online booking closes</dt>
                      <dd className="sm:col-span-2">{mins(category.booking_closes_minutes)} before</dd>
                      <dt className="text-muted-foreground">Late-cancel window</dt>
                      <dd className="sm:col-span-2">{mins(category.cancel_window_minutes)}</dd>
                      <dt className="text-muted-foreground">Late-cancel fee</dt>
                      <dd className="sm:col-span-2">{money(category.late_cancel_fee_cents)}</dd>
                      <dt className="text-muted-foreground">No-show fee</dt>
                      <dd className="sm:col-span-2">{money(category.no_show_fee_cents)}</dd>
                    </dl>
                    <CatalogEditDialog
                      entity="program"
                      id={category.id as string}
                      title={`${category.name as string} booking rules`}
                      values={pick(category, programFields)}
                      edited={category.edited}
                      triggerLabel="Edit rules"
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </DashboardShell>
  );
}
