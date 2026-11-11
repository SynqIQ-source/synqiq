import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appointmentPayCents, classPayCents, resolveRate, toPayRate, type PayRate } from "@/lib/payroll/rates";
import { shiftMinutes } from "@/lib/time-clock/hours";

// Payroll for a pay period (studio dates, inclusive), per person:
//   hourly   time clock hours x their hourly rate
//   classes  each class they taught (the substitute if subbed), paid clients
//            -> their class rate (schedule > class type > default)
//   sessions each completed appointment -> their session rate, where a
//            percent rate uses the session's value: the pre-tax price of the
//            pack the client used / sessions in that pack (comp = $0)
//   commission  the commission lines earned in the period (incl. clawbacks)
// Everything is read from SynqIQ's synced data; nothing is written.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type PayrollClass = {
  occurrenceId: string;
  startsAt: string;
  endsAt: string | null;
  name: string;
  heads: number;
  rateName: string | null;
  amountCents: number;
};
export type PayrollSession = {
  appointmentId: number;
  startsAt: string;
  endsAt: string | null;
  sessionType: string;
  client: string; // "A. Smith"
  service: string | null;
  valueCents: number | null;
  estimated: boolean; // value from the pack's usual price (the client's own purchase isn't on file)
  noShow: boolean;
  rateName: string | null;
  amountCents: number;
};
export type PayrollPerson = {
  staffId: string;
  name: string;
  hourly: { minutes: number; rateCents: number | null; amountCents: number; shifts: number };
  classes: PayrollClass[];
  sessions: PayrollSession[];
  commissionCents: number;
  commissionLines: number;
  totalCents: number;
  missingRates: string[]; // things that could not be paid because no rate is set
};

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
const chunk = <T>(list: T[], size = 300) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export async function buildPayroll(organizationId: string, from: string, to: string, admin: Admin = createSupabaseAdminClient()) {
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";
  const startIso = DateTime.fromISO(from, { zone: timezone }).startOf("day").toUTC().toISO()!;
  const endIso = DateTime.fromISO(to, { zone: timezone }).plus({ days: 1 }).startOf("day").toUTC().toISO()!;
  const now = new Date();

  const [staff, settings, rateRows, assignments, punches, classes, schedules, appointments, sessionTypes, commission] = await Promise.all([
    all((a, b) =>
      admin.from("staff").select("id, display_name, mindbody_staff_id").eq("organization_id", organizationId).order("id").range(a, b),
    ),
    all((a, b) =>
      admin
        .from("staff_pay_settings")
        .select("staff_id, hourly_rate_cents, class_rate_id, appointment_rate_id")
        .eq("organization_id", organizationId)
        .order("staff_id")
        .range(a, b),
    ),
    all((a, b) => admin.from("pay_rates").select("*").eq("organization_id", organizationId).order("id").range(a, b)),
    all((a, b) =>
      admin
        .from("staff_pay_assignments")
        .select("staff_id, scope, mindbody_id, pay_rate_id")
        .eq("organization_id", organizationId)
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("time_punches")
        .select("staff_id, clock_in_at, clock_out_at")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .gte("clock_in_at", startIso)
        .lt("clock_in_at", endIso)
        .order("clock_in_at")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("class_occurrences")
        .select("id, mindbody_class_schedule_id, class_name, staff_id, substitute_staff_id, start_datetime, end_datetime, total_signed_in")
        .eq("organization_id", organizationId)
        .gte("start_datetime", startIso)
        .lt("start_datetime", endIso)
        .lte("start_datetime", now.toISOString())
        .order("start_datetime")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("class_schedules")
        .select("mindbody_class_schedule_id, mindbody_class_description_id")
        .eq("organization_id", organizationId)
        .order("mindbody_class_schedule_id")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("appointment_occurrences")
        .select("mindbody_appointment_id, staff_id, client_id, session_type_id, status, start_datetime, end_datetime")
        .eq("organization_id", organizationId)
        .in("status", ["Completed", "Arrived", "NoShow", "Booked", "Confirmed"])
        .lte("start_datetime", now.toISOString())
        .gte("start_datetime", startIso)
        .lt("start_datetime", endIso)
        .order("start_datetime")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("session_types")
        .select("mindbody_session_type_id, name")
        .eq("organization_id", organizationId)
        .order("mindbody_session_type_id")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("commission_lines")
        .select("staff_id, amount_cents")
        .eq("organization_id", organizationId)
        .gte("earned_at", startIso)
        .lt("earned_at", endIso)
        .order("id")
        .range(a, b),
    ),
  ]);

  const rates = new Map<string, PayRate>(rateRows.map((row) => [row.id as string, toPayRate(row)]));
  const settingBy = new Map(settings.map((row) => [row.staff_id as string, row]));
  const nameBy = new Map(staff.map((row) => [row.id as string, (row.display_name as string | null) ?? "Unknown"]));
  const typeBySchedule = new Map(
    schedules.map((row) => [Number(row.mindbody_class_schedule_id), Number(row.mindbody_class_description_id)]),
  );
  const sessionTypeName = new Map(sessionTypes.map((row) => [Number(row.mindbody_session_type_id), row.name as string]));
  const assignmentsBy = new Map<string, { scope: string; mindbodyId: number; payRateId: string }[]>();
  for (const row of assignments) {
    const list = assignmentsBy.get(row.staff_id as string) ?? [];
    list.push({ scope: row.scope as string, mindbodyId: Number(row.mindbody_id), payRateId: row.pay_rate_id as string });
    assignmentsBy.set(row.staff_id as string, list);
  }

  const [sessionValues, visitCounts] = await Promise.all([
    loadSessionValues(
      admin,
      organizationId,
      appointments.map((row) => Number(row.mindbody_appointment_id)),
    ),
    loadClassVisitCounts(
      admin,
      organizationId,
      classes.map((row) => row.id as string),
    ),
  ]);

  const people = new Map<string, PayrollPerson>();
  const person = (staffId: string) => {
    let entry = people.get(staffId);
    if (!entry) {
      entry = {
        staffId,
        name: nameBy.get(staffId) ?? "Unknown",
        hourly: { minutes: 0, rateCents: null, amountCents: 0, shifts: 0 },
        classes: [],
        sessions: [],
        commissionCents: 0,
        commissionLines: 0,
        totalCents: 0,
        missingRates: [],
      };
      people.set(staffId, entry);
    }
    return entry;
  };

  for (const punch of punches) {
    const entry = person(punch.staff_id as string);
    entry.hourly.minutes += shiftMinutes(punch.clock_in_at as string, (punch.clock_out_at as string | null) ?? null, now);
    entry.hourly.shifts += 1;
  }

  for (const occurrence of classes) {
    const teacher = (occurrence.substitute_staff_id as string | null) ?? (occurrence.staff_id as string | null);
    if (!teacher) continue;
    const entry = person(teacher);
    const scheduleId = occurrence.mindbody_class_schedule_id == null ? null : Number(occurrence.mindbody_class_schedule_id);
    const rateId = resolveRate(
      assignmentsBy.get(teacher) ?? [],
      [
        { scope: "class_schedule", mindbodyId: scheduleId },
        { scope: "class_type", mindbodyId: scheduleId == null ? null : typeBySchedule.get(scheduleId) },
      ],
      (settingBy.get(teacher)?.class_rate_id as string | null) ?? null,
    );
    const rate = rateId ? rates.get(rateId) : undefined;
    // Paid clients = the class's visit records (signed in, plus no-shows that
    // used a session), as Mindbody counts them; the occurrence's own
    // signed-in total can be stale.
    const heads = visitCounts.get(occurrence.id as string) ?? Number(occurrence.total_signed_in ?? 0);
    if (!rate && !entry.missingRates.includes("class rate")) entry.missingRates.push("class rate");
    entry.classes.push({
      occurrenceId: occurrence.id as string,
      startsAt: occurrence.start_datetime as string,
      endsAt: (occurrence.end_datetime as string | null) ?? null,
      name: (occurrence.class_name as string | null) ?? "Class",
      heads,
      rateName: rate?.name ?? null,
      amountCents: rate ? classPayCents(rate, heads) : 0,
    });
  }

  for (const appointment of appointments) {
    const trainer = appointment.staff_id as string | null;
    if (!trainer) continue;
    const entry = person(trainer);
    const typeId = appointment.session_type_id == null ? null : Number(appointment.session_type_id);
    const rateId = resolveRate(
      assignmentsBy.get(trainer) ?? [],
      [{ scope: "session_type", mindbodyId: typeId }],
      (settingBy.get(trainer)?.appointment_rate_id as string | null) ?? null,
    );
    const rate = rateId ? rates.get(rateId) : undefined;
    const value = sessionValues.get(Number(appointment.mindbody_appointment_id));
    // A no-show (or a past session never closed out) is paid only when the
    // client was charged a session for it.
    if (appointment.status !== "Completed" && appointment.status !== "Arrived" && !value?.service) continue;
    if (!rate && !entry.missingRates.includes("session rate")) entry.missingRates.push("session rate");
    entry.sessions.push({
      appointmentId: Number(appointment.mindbody_appointment_id),
      startsAt: appointment.start_datetime as string,
      endsAt: (appointment.end_datetime as string | null) ?? null,
      sessionType: (typeId != null ? sessionTypeName.get(typeId) : null) ?? "Session",
      client: value?.client ?? "",
      service: value?.service ?? null,
      valueCents: value?.valueCents ?? null,
      estimated: value?.estimated ?? false,
      noShow: appointment.status === "NoShow",
      rateName: rate?.name ?? null,
      amountCents: rate ? appointmentPayCents(rate, value?.valueCents ?? 0) : 0,
    });
  }

  for (const line of commission) {
    const entry = person(line.staff_id as string);
    entry.commissionCents += Number(line.amount_cents);
    entry.commissionLines += 1;
  }

  for (const entry of people.values()) {
    const setting = settingBy.get(entry.staffId);
    entry.hourly.rateCents = setting?.hourly_rate_cents == null ? null : Number(setting.hourly_rate_cents);
    entry.hourly.amountCents = entry.hourly.rateCents == null ? 0 : Math.round((entry.hourly.minutes / 60) * entry.hourly.rateCents);
    if (entry.hourly.minutes > 0 && entry.hourly.rateCents == null) entry.missingRates.push("hourly rate");
    entry.totalCents =
      entry.hourly.amountCents +
      entry.classes.reduce((sum, item) => sum + item.amountCents, 0) +
      entry.sessions.reduce((sum, item) => sum + item.amountCents, 0) +
      entry.commissionCents;
  }
  return {
    timezone,
    from,
    to,
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// The value of each appointment: the pre-tax price of the pack the client
// used for it divided by the sessions in that pack. Mindbody's visit record
// names the pack (service); the client's matching service row gives the
// sessions and product; the client's sale of that product gives the price.
async function loadSessionValues(admin: Admin, organizationId: string, appointmentIds: number[]) {
  const values = new Map<number, { valueCents: number | null; estimated: boolean; service: string | null; client: string }>();
  if (appointmentIds.length === 0) return values;
  const visits = (
    await Promise.all(
      chunk(appointmentIds).map((ids) =>
        admin
          .from("member_visits")
          .select("appointment_id, mindbody_client_id, service_name, start_local")
          .eq("organization_id", organizationId)
          .in("appointment_id", ids),
      ),
    )
  ).flatMap((result) => result.data ?? []);
  const clientIds = [...new Set(visits.map((visit) => visit.mindbody_client_id as string))];
  const [services, sales, clients] = await Promise.all([
    Promise.all(
      chunk(clientIds).map((ids) =>
        all((a, b) =>
          admin
            .from("member_services")
            .select("mindbody_client_id, name, count, product_id, payment_date, active_date, expiration_date, is_current")
            .eq("organization_id", organizationId)
            .in("mindbody_client_id", ids)
            .order("id")
            .range(a, b),
        ),
      ),
    ).then((parts) => parts.flat()),
    Promise.all(
      chunk(clientIds).map((ids) =>
        all((a, b) =>
          admin
            .from("member_sales")
            .select("mindbody_sale_id, mindbody_client_id, sale_at")
            .eq("organization_id", organizationId)
            .in("mindbody_client_id", ids)
            .order("mindbody_sale_id")
            .range(a, b),
        ),
      ),
    ).then((parts) => parts.flat()),
    Promise.all(
      chunk(clientIds).map((ids) =>
        admin
          .from("clients")
          .select("mindbody_unique_id, first_name, last_name")
          .eq("organization_id", organizationId)
          .in(
            "mindbody_unique_id",
            ids.map(Number).filter((id) => Number.isInteger(id) && id < 2_147_483_647),
          ),
      ),
    ).then((parts) => parts.flatMap((result) => result.data ?? [])),
  ]);
  const saleIds = sales.map((sale) => Number(sale.mindbody_sale_id));
  const items = (
    await Promise.all(
      chunk(saleIds).map((ids) =>
        all((a, b) =>
          admin
            .from("member_sale_items")
            .select("mindbody_sale_id, product_id, total_cents, tax_cents, returned")
            .eq("organization_id", organizationId)
            .in("mindbody_sale_id", ids)
            .order("mindbody_sale_detail_id")
            .range(a, b),
        ),
      ),
    )
  ).flat();
  const saleBy = new Map(sales.map((sale) => [Number(sale.mindbody_sale_id), sale]));
  // client|product -> [{ day, preTaxCents }]
  const purchases = new Map<string, { day: string; cents: number }[]>();
  for (const item of items) {
    if (item.product_id == null) continue;
    const sale = saleBy.get(Number(item.mindbody_sale_id));
    if (!sale) continue;
    const key = `${sale.mindbody_client_id}|${item.product_id}`;
    const list = purchases.get(key) ?? [];
    list.push({
      day: String(sale.sale_at).slice(0, 10),
      cents: Math.max(0, Number(item.total_cents ?? 0) - Number(item.tax_cents ?? 0)),
    });
    purchases.set(key, list);
  }
  const clientName = new Map(
    clients.map((row) => [String(row.mindbody_unique_id), `${String(row.first_name ?? "").charAt(0)}. ${row.last_name ?? ""}`.trim()]),
  );
  const same = (a: unknown, b: unknown) =>
    String(a ?? "")
      .trim()
      .toLowerCase() ===
    String(b ?? "")
      .trim()
      .toLowerCase();
  const chosen = visits.map((visit) => {
    const client = visit.mindbody_client_id as string;
    const day = String(visit.start_local).slice(0, 10);
    const matching = services.filter((service) => service.mindbody_client_id === client && same(service.name, visit.service_name));
    const active = matching.filter(
      (service) =>
        (!service.active_date || String(service.active_date).slice(0, 10) <= day) &&
        (!service.expiration_date || String(service.expiration_date).slice(0, 10) >= day),
    );
    const service = (active.length ? active : matching).sort(
      (a, b) =>
        Number(Boolean(b.is_current)) - Number(Boolean(a.is_current)) ||
        String(b.payment_date ?? "").localeCompare(String(a.payment_date ?? "")),
    )[0];
    return { visit, client, day, service };
  });

  // The usual pre-tax price of each pack, for clients whose own purchase
  // isn't on file (bought before the synced history, or paid by someone else).
  const productIds = [...new Set(chosen.map((c) => c.service?.product_id).filter((id) => id != null))] as number[];
  const usual = new Map<number, number>();
  if (productIds.length) {
    const rows = await all((a, b) =>
      admin
        .from("member_sale_items")
        .select("product_id, quantity, total_cents, tax_cents")
        .eq("organization_id", organizationId)
        .in("product_id", productIds)
        .gt("total_cents", 0)
        .order("mindbody_sale_detail_id", { ascending: false })
        .range(a, b),
    );
    const counts = new Map<number, Map<number, number>>();
    for (const row of rows) {
      const quantity = Math.max(1, Number(row.quantity ?? 1));
      const cents = Math.round((Number(row.total_cents) - Number(row.tax_cents ?? 0)) / quantity);
      const tally = counts.get(Number(row.product_id)) ?? new Map<number, number>();
      tally.set(cents, (tally.get(cents) ?? 0) + 1);
      counts.set(Number(row.product_id), tally);
    }
    for (const [product, tally] of counts) usual.set(product, [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }

  for (const { visit, client, day, service } of chosen) {
    let valueCents: number | null = null;
    let estimated = false;
    if (service && service.product_id != null && Number(service.count) > 0) {
      const bought = purchases.get(`${client}|${service.product_id}`) ?? [];
      const paid = String(service.payment_date ?? "").slice(0, 10);
      const match =
        bought.find((purchase) => purchase.day === paid) ??
        bought.filter((purchase) => purchase.day <= day).sort((a, b) => b.day.localeCompare(a.day))[0];
      if (match) valueCents = Math.round(match.cents / Number(service.count));
      else if (usual.has(Number(service.product_id))) {
        valueCents = Math.round(usual.get(Number(service.product_id))! / Number(service.count));
        estimated = true;
      }
    }
    values.set(Number(visit.appointment_id), {
      valueCents,
      estimated,
      service: (visit.service_name as string | null) ?? null,
      client: clientName.get(client) ?? "",
    });
  }
  return values;
}

// Visit records per class occurrence.
async function loadClassVisitCounts(admin: Admin, organizationId: string, occurrenceIds: string[]) {
  const counts = new Map<string, number>();
  const rows = (
    await Promise.all(
      chunk(occurrenceIds, 150).map((ids) =>
        all((a, b) =>
          admin
            .from("class_visits")
            .select("occurrence_id")
            .eq("organization_id", organizationId)
            .in("occurrence_id", ids)
            .order("id")
            .range(a, b),
        ),
      ),
    )
  ).flat();
  for (const row of rows) counts.set(row.occurrence_id as string, (counts.get(row.occurrence_id as string) ?? 0) + 1);
  return counts;
}
