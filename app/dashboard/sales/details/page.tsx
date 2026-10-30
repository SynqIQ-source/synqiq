import Link from "next/link";
import { DateTime } from "luxon";
import { ArrowLeft } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadAppointmentsMade, loadSalesContacts } from "@/lib/crm/funnel";
import { isLeadType, LEAD_TYPES } from "@/lib/crm/labels";
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

const APPOINTMENT_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  showed: "Showed",
  no_show: "No-show",
};

// Sales dashboard drill-down: the guests behind a Contacts or Appointments
// made number, for the same period and filters, read through the same
// loaders as the dashboard (lib/crm/funnel.ts) so the lists match the
// counts. Each name opens the guest's profile.
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
  const metric: ContactMetric | "appointments_made" =
    params.metric === "appointments_made" || (params.metric ?? "") in CONTACT_METRICS
      ? (params.metric as ContactMetric | "appointments_made")
      : "contacts";

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
  const shell = (title: string, count: string, children: React.ReactNode) => (
    <DashboardShell
      title={title}
      description={`${count} · ${who}${typeLabel ? ` · ${typeLabel} leads` : ""} · ${periodLabel}`}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>
            <ArrowLeft /> Sales
          </Link>
        </Button>
      }
    >
      <Card className="py-0">{children}</Card>
    </DashboardShell>
  );
  const guestLink = (contact: { id: string; first_name: string; last_name: string }) => (
    <Link href={`/dashboard/guests/${contact.id}`} className="font-medium hover:underline">
      {contact.first_name} {contact.last_name}
    </Link>
  );

  if (metric === "appointments_made") {
    const rows = await loadAppointmentsMade(supabase, options);
    return shell(
      "Appointments made",
      rows.length === 1 ? "1 appointment" : `${rows.length} appointments`,
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Guest</TableHead>
            <TableHead>Appointment</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>With</TableHead>
            <TableHead>Booked by</TableHead>
            <TableHead>Booked</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                No appointments were booked in this period.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{guestLink(row.contact)}</TableCell>
                <TableCell className="whitespace-nowrap">{local(row.scheduled_at, "ccc, LLL d, h:mm a")}</TableCell>
                <TableCell>{APPOINTMENT_LABELS[row.status] ?? row.status}</TableCell>
                <TableCell>{nameOf(row.staff_id)}</TableCell>
                <TableCell>{nameOf(row.created_by_staff_id)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{local(row.created_at)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>,
    );
  }

  const { title, channel } = CONTACT_METRICS[metric];
  const messages = (await loadSalesContacts(supabase, options)).filter(
    (message) => !channel || message.channel === channel,
  );
  // One row per guest, newest contact first.
  const byGuest = new Map<
    string,
    {
      contact: (typeof messages)[number]["contact"];
      calls: number;
      texts: number;
      emails: number;
      lastAt: string;
      by: Set<string>;
    }
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
    `${messages.length} ${messages.length === 1 ? title.toLowerCase().replace(/s$/, "") : title.toLowerCase()} · ${rows.length} ${rows.length === 1 ? "guest" : "guests"}`,
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
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
              Nothing in this period.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            return (
              <TableRow key={row.contact.id}>
                <TableCell>{guestLink(row.contact)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.calls}</TableCell>
                <TableCell className="text-right tabular-nums">{row.texts}</TableCell>
                <TableCell className="text-right tabular-nums">{row.emails}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{local(row.lastAt)}</TableCell>
                <TableCell>{[...row.by].join(", ") || "—"}</TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>,
  );
}
