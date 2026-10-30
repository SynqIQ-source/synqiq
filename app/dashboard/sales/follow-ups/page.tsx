import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { NextFollowUp } from "@/components/crm/follow-up-status";
import { RescheduleFollowUp } from "@/components/crm/reschedule-follow-up";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  activityFor,
  FOLLOW_UP_CONTACT_FIELDS,
  followUpFor,
  loadLeadActivity,
  loadOpenFollowUpContacts,
  QUEUE_LABELS,
  type FollowUp,
  type FollowUpContact,
} from "@/lib/crm/follow-ups";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { getScopedClient } from "@/lib/supabase/scoped";
import { FollowUpFilters } from "./follow-up-filters";

export const dynamic = "force-dynamic";

const VIEWS = ["overdue", "today", "due", "upcoming", "all"] as const;
type View = (typeof VIEWS)[number];

type OpenContact = FollowUpContact & { first_name: string; last_name: string };

// Follow-ups: open leads whose follow-up is overdue (the default), due today
// or coming up, on the cadence in lib/crm/follow-ups.ts. A text, email or
// logged call clears one; Reschedule moves it to a date. Admins see every
// salesperson's counts side by side; salespeople see their own leads.
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; queue?: string; seller?: string }>;
}) {
  const staff = await requireCrmStaff();
  const params = await searchParams;
  const isAdmin = staff.role === "admin";
  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);

  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : "overdue";
  const queue = params.queue === "lead" || params.queue === "visited" ? params.queue : "all";
  const sellerParam = isAdmin ? (params.seller ?? "all") : staff.id;

  const { data: staffRows } = await supabase
    .from("staff")
    .select("id, display_name, can_sell, role, archived_at")
    .order("display_name");
  const staffNames = new Map((staffRows ?? []).map((member) => [member.id, member.display_name as string]));
  const salespeople = (staffRows ?? [])
    .filter((member) => !member.archived_at && (member.can_sell || member.role === "admin"))
    .map((member) => ({ id: member.id, name: member.display_name as string }));

  // Everyone open, so the per-salesperson counts cover the whole club; the
  // salesperson filter then narrows the list.
  const contacts = await loadOpenFollowUpContacts<OpenContact>(
    supabase,
    `${FOLLOW_UP_CONTACT_FIELDS}, first_name, last_name`,
    isAdmin ? null : staff.id,
  );
  const activity = await loadLeadActivity(
    supabase,
    contacts.map((contact) => contact.id),
  );
  const now = DateTime.now();
  const today = now.setZone(org.timezone).toISODate()!;
  const all = contacts.map((contact) => {
    const contactActivity = activityFor(activity, contact.id);
    return {
      contact,
      lastContactAt: contactActivity.contactTimes.at(-1) ?? null,
      followUp: followUpFor(contact, contactActivity, org.timezone, now),
    };
  });

  const bySeller = new Map<string, { overdue: number; today: number; open: number }>();
  for (const row of all) {
    const key = row.contact.assigned_staff_id ?? "";
    const counts = bySeller.get(key) ?? { overdue: 0, today: 0, open: 0 };
    counts.open += 1;
    if (row.followUp.kind === "due" && row.followUp.daysOverdue > 0) counts.overdue += 1;
    if (row.followUp.kind === "due" && row.followUp.daysOverdue === 0) counts.today += 1;
    bySeller.set(key, counts);
  }
  const sellerSummary = [...bySeller.entries()]
    .map(([id, counts]) => ({ id, name: id ? (staffNames.get(id) ?? "—") : "Unassigned", ...counts }))
    .sort((a, b) => b.overdue - a.overdue || b.today - a.today || a.name.localeCompare(b.name));

  const inView = (followUp: FollowUp) => {
    if (followUp.kind === "stopped") return false;
    if (view === "all") return true;
    if (followUp.kind === "appointment") return view === "upcoming";
    if (view === "overdue") return followUp.daysOverdue > 0;
    if (view === "today") return followUp.daysOverdue === 0;
    if (view === "due") return followUp.daysOverdue >= 0;
    return followUp.daysOverdue < 0;
  };
  const sortKey = (followUp: FollowUp) =>
    followUp.kind === "due" ? followUp.dueOn : followUp.kind === "appointment" ? followUp.at.slice(0, 10) : "9999";
  const rows = all
    .filter((row) => sellerParam === "all" || (row.contact.assigned_staff_id ?? "unassigned") === sellerParam)
    .filter((row) => queue === "all" || (row.followUp.kind === "due" ? row.followUp.queue === queue : queue === "lead"))
    .filter((row) => inView(row.followUp))
    .sort((a, b) => sortKey(a.followUp).localeCompare(sortKey(b.followUp)));

  const totalOverdue = sellerSummary.reduce((sum, row) => sum + row.overdue, 0);
  const totalToday = sellerSummary.reduce((sum, row) => sum + row.today, 0);
  const local = (iso: string) => DateTime.fromISO(iso).setZone(org.timezone).toFormat("LLL d, h:mm a");

  return (
    <DashboardShell
      title="Follow-ups"
      description={`${totalOverdue} overdue · ${totalToday} due today${isAdmin ? " across the club" : ""}`}
      actions={
        <FollowUpFilters view={view} queue={queue} seller={sellerParam} salespeople={isAdmin ? salespeople : null} />
      }
    >
      <div className="space-y-6">
        {isAdmin && sellerSummary.length > 0 ? (
          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle>By salesperson</CardTitle>
              <CardDescription>Follow-ups overdue right now, for each salesperson&apos;s open leads.</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="text-right">Due today</TableHead>
                  <TableHead className="text-right">Open leads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellerSummary.map((row) => (
                  <TableRow key={row.id || "unassigned"}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/sales/follow-ups?seller=${row.id || "unassigned"}`}
                        className="hover:underline"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className={row.overdue ? "text-right font-semibold text-destructive tabular-nums" : "text-right tabular-nums"}>
                      {row.overdue}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.today}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.open}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ) : null}

        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Visited</TableHead>
                <TableHead>Salesperson</TableHead>
                <TableHead>Last contact</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {view === "overdue" ? "No overdue follow-ups." : "Nothing here."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.contact.id}>
                    <TableCell className="font-medium">
                      <Link href={`/dashboard/guests/${row.contact.id}`} className="hover:underline">
                        {row.contact.first_name} {row.contact.last_name}
                      </Link>
                    </TableCell>
                    <TableCell>{row.followUp.kind === "due" ? QUEUE_LABELS[row.followUp.queue] : "—"}</TableCell>
                    <TableCell>
                      {row.contact.assigned_staff_id
                        ? (staffNames.get(row.contact.assigned_staff_id) ?? "—")
                        : "Unassigned"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {row.lastContactAt ? local(row.lastContactAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      <NextFollowUp followUp={row.followUp} timezone={org.timezone} />
                    </TableCell>
                    <TableCell className="text-right">
                      {row.followUp.kind === "due" ? (
                        <RescheduleFollowUp
                          contactId={row.contact.id}
                          today={today}
                          current={row.followUp.rescheduled ? row.followUp.dueOn : null}
                          compact
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
        <p className="text-xs text-muted-foreground">
          Before a first visit, a follow-up is due every day for the first week after a guest is added (paused while an
          appointment is booked; a no-show or cancellation starts the week again), then every 3 days. After a visit,
          it&apos;s every 2 days for the first 14 days, then every 3 days. A text, email or logged call completes the
          follow-up; follow-ups stop when a guest enrolls, is marked not interested, or replies STOP.
        </p>
      </div>
    </DashboardShell>
  );
}
