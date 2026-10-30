import Link from "next/link";
import { DateTime } from "luxon";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { LeadTypeTag, OutcomeLabel } from "@/components/crm/guest-tags";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  computeFunnelLists,
  FUNNEL_LISTS,
  loadAppointmentsMade,
  loadSalesContacts,
  type FunnelAppointment,
  type FunnelContact,
} from "@/lib/crm/funnel";
import { appointmentOutcome, isLeadType, LEAD_TYPES, SOURCE_LABELS } from "@/lib/crm/labels";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { resolvePeriod } from "@/lib/crm/period";
import { getScopedClient } from "@/lib/supabase/scoped";

export const dynamic = "force-dynamic";

const CONTACT_METRICS = {
  contacts: { title: "Contacts", channel: null },
  calls: { title: "Calls", channel: "call" },
  texts: { title: "Texts", channel: "sms" },
  emails: { title: "Emails", channel: "email" },
} as const;
type ContactMetric = keyof typeof CONTACT_METRICS;

// Sales dashboard drill-down: the guests (or appointments) behind any
// dashboard number, for the same period and filters. The lists come from the
// same code as the dashboard (lib/crm/funnel.ts), so they match the counts.
// Each name opens the guest's profile.
//
//   metric=walk_ins, leads_shows, appointments_scheduled... (FUNNEL_LISTS),
//   source:<label> (leads by marketing source), contacts/calls/texts/emails,
//   appointments_made.
export default async function SalesDetailsPage({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string; range?: string; start?: string; end?: string; seller?: string; type?: string }>;
}) {
  const staff = await requireCrmStaff();
  const params = await searchParams;
  const isAdmin = staff.role === "admin";
  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const period = resolvePeriod(params, {
    presets: ["mtd", "today", "7", "last_month", "custom"],
    fallback: "mtd",
    timezone: org.timezone,
  });
  const options = {
    fromIso: period.from.toUTC().toISO()!,
    toIso: period.to.toUTC().toISO()!,
    // Salespeople only see their own, whatever the URL says.
    staffId: isAdmin ? (params.seller ?? null) : staff.id,
    leadType: isLeadType(params.type) ? params.type : null,
  };
  const metric = params.metric ?? "contacts";

  const { data: staffRows } = await supabase.from("staff").select("id, display_name");
  const staffNames = new Map((staffRows ?? []).map((member) => [member.id, member.display_name as string]));
  const nameOf = (id: string | null) => (id ? (staffNames.get(id) ?? "—") : "—");
  const local = (iso: string, format = "LLL d, h:mm a") => DateTime.fromISO(iso).setZone(org.timezone).toFormat(format);

  // Back to the dashboard with the same filters.
  const back = new URLSearchParams();
  for (const key of ["range", "start", "end", "seller", "type"] as const) {
    if (params[key]) back.set(key, params[key]!);
  }
  const backHref = `/dashboard/sales${back.size ? `?${back.toString()}` : ""}`;

  const who = options.staffId ? nameOf(options.staffId) : "The whole club";
  const typeLabel = LEAD_TYPES.find((type) => type.value === options.leadType)?.label;
  const periodLabel = `${period.from.toFormat("LLL d")} – ${period.to.toFormat("LLL d, yyyy")}`;
  const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const shell = (title: string, count: string, children: React.ReactNode, calendar = false) => (
    <DashboardShell
      title={title}
      description={`${count} · ${who}${typeLabel ? ` · ${typeLabel} leads` : ""} · ${periodLabel}`}
      actions={
        <div className="flex gap-2">
          {calendar ? (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/dashboard/sales/calendar?view=month&date=${period.start}${isAdmin && options.staffId ? `&seller=${options.staffId}` : ""}`}
              >
                <CalendarDays /> Calendar
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft /> Sales
            </Link>
          </Button>
        </div>
      }
    >
      <Card className="py-0">{children}</Card>
    </DashboardShell>
  );
  const guestCell = (contact: FunnelContact) => (
    <span className="inline-flex items-center gap-2">
      <Link href={`/dashboard/guests/${contact.id}`} className="font-medium hover:underline">
        {contact.first_name} {contact.last_name}
      </Link>
      <LeadTypeTag contact={contact} />
    </span>
  );
  const empty = (columns: number, text = "Nothing in this period.") => (
    <TableRow>
      <TableCell colSpan={columns} className="py-10 text-center text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );

  const appointmentTable = (title: string, rows: FunnelAppointment[]) =>
    shell(
      title,
      plural(rows.length, "appointment"),
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Guest</TableHead>
            <TableHead>Appointment</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>With</TableHead>
            <TableHead>Booked by</TableHead>
            <TableHead>Booked</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0
            ? empty(6)
            : [...rows]
                .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
                .map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{guestCell(row.contact)}</TableCell>
                    <TableCell className="whitespace-nowrap">{local(row.scheduled_at, "ccc, LLL d, h:mm a")}</TableCell>
                    <TableCell>
                      <OutcomeLabel outcome={appointmentOutcome(row.status, row.contact.closed_at)} />
                    </TableCell>
                    <TableCell>{nameOf(row.staff_id)}</TableCell>
                    <TableCell>{nameOf(row.created_by_staff_id)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{local(row.created_at)}</TableCell>
                  </TableRow>
                ))}
        </TableBody>
      </Table>,
      true,
    );

  if (metric === "appointments_made") {
    return appointmentTable("Appointments made", await loadAppointmentsMade(supabase, options));
  }

  if (metric in CONTACT_METRICS) {
    const { title, channel } = CONTACT_METRICS[metric as ContactMetric];
    const messages = (await loadSalesContacts(supabase, options)).filter(
      (message) => !channel || message.channel === channel,
    );
    // One row per guest, newest contact first.
    const byGuest = new Map<
      string,
      { contact: FunnelContact; calls: number; texts: number; emails: number; lastAt: string; by: Set<string> }
    >();
    for (const message of messages) {
      const row = byGuest.get(message.contact.id) ?? {
        contact: message.contact,
        calls: 0,
        texts: 0,
        emails: 0,
        lastAt: message.created_at,
        by: new Set<string>(),
      };
      if (message.channel === "call") row.calls += 1;
      else if (message.channel === "sms") row.texts += 1;
      else if (message.channel === "email") row.emails += 1;
      if (message.created_at > row.lastAt) row.lastAt = message.created_at;
      if (message.sent_by_staff_id) row.by.add(nameOf(message.sent_by_staff_id));
      byGuest.set(message.contact.id, row);
    }
    const rows = [...byGuest.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return shell(
      title,
      `${plural(messages.length, title.toLowerCase().replace(/s$/, ""))} · ${plural(rows.length, "guest")}`,
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Guest</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Texts</TableHead>
            <TableHead className="text-right">Emails</TableHead>
            <TableHead>Last contact</TableHead>
            <TableHead>By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0
            ? empty(6)
            : rows.map((row) => (
                <TableRow key={row.contact.id}>
                  <TableCell>{guestCell(row.contact)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.texts}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.emails}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{local(row.lastAt)}</TableCell>
                  <TableCell>{[...row.by].join(", ") || "—"}</TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>,
    );
  }

  const { lists } = await computeFunnelLists(supabase, options);
  if (lists.appointments.has(metric)) {
    return appointmentTable(FUNNEL_LISTS[metric], lists.appointments.get(metric)!);
  }
  const contacts = lists.contacts.get(metric);
  const title = metric.startsWith("source:")
    ? `Leads from ${metric.slice("source:".length)}`
    : (FUNNEL_LISTS[metric] ?? "Guests");
  const rows = [...(contacts ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return shell(
    title,
    plural(rows.length, "guest"),
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Guest</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Salesperson</TableHead>
          <TableHead>Added</TableHead>
          <TableHead>Enrolled</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0
          ? empty(5, contacts ? "Nothing in this period." : "That number isn't available. Go back to Sales and pick it again.")
          : rows.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell>{guestCell(contact)}</TableCell>
                <TableCell>{SOURCE_LABELS[contact.source] ?? contact.source}</TableCell>
                <TableCell>{contact.assigned_staff_id ? nameOf(contact.assigned_staff_id) : "Unassigned"}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{local(contact.created_at, "LLL d, yyyy")}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {contact.closed_at ? local(contact.closed_at, "LLL d, yyyy") : "—"}
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>,
  );
}
