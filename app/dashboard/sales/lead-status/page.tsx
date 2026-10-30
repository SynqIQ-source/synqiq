import Link from "next/link";
import { DateTime } from "luxon";
import { Fragment } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { FirstContactBadge, NextFollowUp } from "@/components/crm/follow-up-status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { percent } from "@/lib/crm/funnel";
import {
  activityFor,
  FIRST_CONTACT_HOURS,
  firstContactFor,
  FOLLOW_UP_CONTACT_FIELDS,
  followUpFor,
  formatHours,
  loadLeadActivity,
  type FirstContact,
  type FollowUp,
  type FollowUpContact,
  type LeadActivity,
} from "@/lib/crm/follow-ups";
import { isLeadType, leadTypeOf, LEAD_TYPES, SOURCE_LABELS, STATUS_LABELS } from "@/lib/crm/labels";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { resolvePeriod } from "@/lib/crm/period";
import { getScopedClient } from "@/lib/supabase/scoped";
import { cn } from "@/lib/utils";
import { SalesFilters } from "../sales-filters";

export const dynamic = "force-dynamic";

type LeadContact = FollowUpContact & {
  first_name: string;
  last_name: string;
  source: string;
  referring_client_id: string | null;
  referrer_name_typed: string | null;
};

const LEAD_FIELDS = `${FOLLOW_UP_CONTACT_FIELDS}, first_name, last_name, source, referring_client_id, referrer_name_typed`;

type Row = {
  contact: LeadContact;
  activity: LeadActivity;
  cameInAt: string;
  visited: boolean;
  firstContact: FirstContact;
  followUp: FollowUp;
};

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

// Lead Status: everyone who came in during the period (their first visit,
// or when they were added if they haven't visited), grouped by day, with how
// fast they were first contacted (the 48-hour rule), their texts, emails and
// calls, and their next follow-up. Admins see the club or one salesperson;
// salespeople see their own leads.
export default async function LeadStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; start?: string; end?: string; seller?: string; type?: string }>;
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
  const fromIso = period.from.toUTC().toISO()!;
  const toIso = period.to.toUTC().toISO()!;

  const sellerParam = isAdmin ? (params.seller ?? "all") : staff.id;
  const staffId = sellerParam === "all" ? null : sellerParam;
  const leadType = isLeadType(params.type) ? params.type : null;

  const { data: staffRows } = await supabase
    .from("staff")
    .select("id, display_name, can_sell, role, archived_at")
    .order("display_name");
  const staffNames = new Map((staffRows ?? []).map((member) => [member.id, member.display_name as string]));
  const salespeople = (staffRows ?? [])
    .filter((member) => !member.archived_at && (member.can_sell || member.role === "admin"))
    .map((member) => ({ id: member.id, name: member.display_name as string }));

  // Candidates: added in the period, or visited in it. Whether they "came
  // in" in the period is decided below, from their first visit.
  const [addedResult, visitedResult] = await Promise.all([
    supabase.from("crm_contacts").select("id").gte("created_at", fromIso).lte("created_at", toIso).limit(5000),
    supabase.from("guest_visits").select("contact_id").gte("visit_at", fromIso).lte("visit_at", toIso).limit(5000),
  ]);
  if (addedResult.error || visitedResult.error) throw new Error("Failed to load leads.");
  const candidateIds = [
    ...new Set([
      ...(addedResult.data ?? []).map((row) => row.id as string),
      ...(visitedResult.data ?? []).map((row) => row.contact_id as string),
    ]),
  ];

  const contacts: LeadContact[] = [];
  for (let index = 0; index < candidateIds.length; index += 200) {
    let query = supabase
      .from("crm_contacts")
      .select(LEAD_FIELDS)
      .in("id", candidateIds.slice(index, index + 200))
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .neq("source", "member");
    if (staffId) query = query.eq("assigned_staff_id", staffId);
    const { data, error } = await query.returns<LeadContact[]>();
    if (error) throw new Error("Failed to load leads.");
    contacts.push(...(data ?? []).filter((contact) => !leadType || leadTypeOf(contact) === leadType));
  }

  const activity = await loadLeadActivity(
    supabase,
    contacts.map((contact) => contact.id),
  );
  const now = DateTime.now();
  const rows: Row[] = contacts
    .map((contact) => {
      const contactActivity = activityFor(activity, contact.id);
      const firstContact = firstContactFor(contact, contactActivity, now);
      return {
        contact,
        activity: contactActivity,
        cameInAt: firstContact.cameInAt,
        visited: Boolean(contactActivity.firstVisitAt),
        firstContact,
        followUp: followUpFor(contact, contactActivity, org.timezone, now),
      };
    })
    .filter((row) => row.cameInAt >= fromIso && row.cameInAt <= toIso)
    .sort((a, b) => b.cameInAt.localeCompare(a.cameInAt));

  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const day = DateTime.fromISO(row.cameInAt).setZone(org.timezone).toISODate()!;
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }

  const count = (state: FirstContact["state"]) => rows.filter((row) => row.firstContact.state === state).length;
  const onTime = count("on_time");
  const late = count("late");
  const notContacted = count("overdue");
  const contactedHours = rows.flatMap((row) =>
    row.firstContact.state === "on_time" || row.firstContact.state === "late" ? [row.firstContact.hours] : [],
  );
  const averageHours = contactedHours.length
    ? contactedHours.reduce((sum, hours) => sum + hours, 0) / contactedHours.length
    : null;
  const overdueFollowUps = rows.filter((row) => row.followUp.kind === "due" && row.followUp.daysOverdue > 0).length;
  // Leads still inside their 48 hours aren't counted for or against.
  const judged = onTime + late + notContacted;

  const who = staffId ? (staffNames.get(staffId) ?? staff.displayName) : "The whole club";
  const typeLabel = LEAD_TYPES.find((type) => type.value === leadType)?.label;
  const local = (iso: string, format: string) => DateTime.fromISO(iso).setZone(org.timezone).toFormat(format);

  return (
    <DashboardShell
      title="Lead Status"
      description={`${who}${typeLabel ? ` · ${typeLabel} leads` : ""} · ${period.from.toFormat("LLL d")} – ${period.to.toFormat("LLL d, yyyy")}`}
      actions={
        <SalesFilters
          range={period.preset}
          start={period.start}
          end={period.end}
          seller={sellerParam}
          leadType={leadType ?? "all"}
          salespeople={isAdmin ? salespeople : null}
        />
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Leads" value={String(rows.length)} />
          <Stat
            label={`Contacted ≤ ${FIRST_CONTACT_HOURS}h`}
            value={percent(onTime, judged)}
            sub={`${onTime} of ${judged}`}
            tone={judged === 0 ? undefined : onTime === judged ? "good" : undefined}
          />
          <Stat label="Contacted late" value={String(late)} tone={late ? "bad" : undefined} />
          <Stat
            label="Not contacted"
            value={String(notContacted)}
            sub={`past ${FIRST_CONTACT_HOURS}h`}
            tone={notContacted ? "bad" : undefined}
          />
          <Stat label="Avg first contact" value={averageHours === null ? "—" : formatHours(averageHours)} />
          <Stat label="Overdue follow-ups" value={String(overdueFollowUps)} tone={overdueFollowUps ? "bad" : undefined} />
        </div>

        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Came in</TableHead>
                <TableHead>Salesperson</TableHead>
                <TableHead>Time to first contact</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Texts</TableHead>
                <TableHead className="text-right">Emails</TableHead>
                <TableHead>Next follow-up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                    No leads came in during this period.
                  </TableCell>
                </TableRow>
              ) : (
                [...byDay.entries()].map(([day, dayRows]) => (
                  <Fragment key={day}>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={10} className="py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {DateTime.fromISO(day, { zone: org.timezone }).toFormat("cccc, LLL d")} · {dayRows.length}{" "}
                        {dayRows.length === 1 ? "lead" : "leads"}
                      </TableCell>
                    </TableRow>
                    {dayRows.map((row) => (
                      <TableRow key={row.contact.id}>
                        <TableCell className="font-medium">
                          <Link href={`/dashboard/guests/${row.contact.id}`} className="hover:underline">
                            {row.contact.first_name} {row.contact.last_name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {row.contact.closed_at ? (
                            <Badge variant="secondary">Enrolled</Badge>
                          ) : (
                            (STATUS_LABELS[row.contact.status] ?? row.contact.status)
                          )}
                        </TableCell>
                        <TableCell>{SOURCE_LABELS[row.contact.source] ?? row.contact.source}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {local(row.cameInAt, "h:mm a")}
                          <span className="ml-1 text-xs">{row.visited ? "visit" : "added"}</span>
                        </TableCell>
                        <TableCell>
                          {row.contact.assigned_staff_id
                            ? (staffNames.get(row.contact.assigned_staff_id) ?? "—")
                            : "Unassigned"}
                        </TableCell>
                        <TableCell>
                          <FirstContactBadge firstContact={row.firstContact} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.activity.calls}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.activity.texts}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.activity.emails}</TableCell>
                        <TableCell>
                          <NextFollowUp followUp={row.followUp} timezone={org.timezone} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
        <Card>
          <CardContent className="text-xs text-muted-foreground">
            Time to first contact runs from a guest&apos;s first visit (or from when they were added, if they
            haven&apos;t visited) to the first text, email or logged call after it. The goal is {FIRST_CONTACT_HOURS}{" "}
            hours. Calls, texts and emails count everything sent to the guest, by anyone.
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
