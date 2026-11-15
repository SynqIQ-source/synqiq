import { managesSales } from "@/lib/permissions";
import Link from "next/link";
import { DateTime } from "luxon";
import { Fragment } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { AddLeadButton } from "../../guests/add-lead-button";
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

const PAGE_SIZE = 100;
const REPLY_DAYS = 7;

type Row = {
  contact: LeadContact;
  lastReplyAt: string | null;
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
  searchParams: Promise<{ range?: string; start?: string; end?: string; seller?: string; type?: string; view?: string; page?: string }>;
}) {
  const staff = await requireCrmStaff();
  const params = await searchParams;
  // Club admins and sales leads see every salesperson; Sales see their own.
  const isAdmin = managesSales(staff);
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

  const [{ data: staffRows }, { data: sourceRows }] = await Promise.all([
    supabase.from("staff").select("id, display_name, can_sell, role, archived_at").order("display_name"),
    supabase.from("crm_marketing_sources").select("label").eq("active", true).order("sort_order"),
  ]);
  const staffNames = new Map((staffRows ?? []).map((member) => [member.id, member.display_name as string]));
  const salespeople = (staffRows ?? [])
    .filter((member) => !member.archived_at && member.can_sell)
    .map((member) => ({ id: member.id, name: member.display_name as string }));

  // Three views: the date-range report; every open lead (the working list,
  // any date, paged); and leads who replied (text, email or form) lately.
  const view = params.view === "open" || params.view === "replied" ? params.view : "period";
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  let openTotal = 0;
  const lastReply = new Map<string, string>();
  let candidateIds: string[] = [];
  if (view === "period") {
    // Added in the period, or visited in it. Whether they "came in" in the
    // period is decided below, from their first visit.
    const [addedResult, visitedResult] = await Promise.all([
      supabase.from("crm_contacts").select("id").gte("created_at", fromIso).lte("created_at", toIso).limit(5000),
      supabase.from("guest_visits").select("contact_id").gte("visit_at", fromIso).lte("visit_at", toIso).limit(5000),
    ]);
    if (addedResult.error || visitedResult.error) throw new Error("Failed to load leads.");
    candidateIds = [
      ...new Set([
        ...(addedResult.data ?? []).map((row) => row.id as string),
        ...(visitedResult.data ?? []).map((row) => row.contact_id as string),
      ]),
    ];
  } else if (view === "open") {
    // Still being worked: not a member, not marked not interested. Follow-ups
    // due first, then the most recently active.
    let query = supabase
      .from("crm_contacts")
      .select("id", { count: "exact" })
      .in("status", ["lead", "guest"])
      .is("deleted_at", null)
      .is("merged_into_id", null)
      .neq("source", "member");
    if (staffId) query = query.eq("assigned_staff_id", staffId);
    const { data, count, error } = await query
      .order("follow_up_on", { ascending: true, nullsFirst: false })
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (error) throw new Error("Failed to load leads.");
    openTotal = count ?? 0;
    candidateIds = (data ?? []).map((row) => row.id as string);
  } else {
    const since = DateTime.now().minus({ days: REPLY_DAYS }).toUTC().toISO()!;
    const { data, error } = await supabase
      .from("crm_messages")
      .select("contact_id, created_at")
      .eq("direction", "inbound")
      .in("channel", ["sms", "email", "web"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) throw new Error("Failed to load replies.");
    for (const row of data ?? [])
      if (!lastReply.has(row.contact_id as string)) lastReply.set(row.contact_id as string, row.created_at as string);
    candidateIds = [...lastReply.keys()];
  }

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
        lastReplyAt: lastReply.get(contact.id) ?? null,
        activity: contactActivity,
        cameInAt: firstContact.cameInAt,
        visited: Boolean(contactActivity.firstVisitAt),
        firstContact,
        followUp: followUpFor(contact, contactActivity, org.timezone, now),
      };
    })
    .filter((row) => view !== "period" || (row.cameInAt >= fromIso && row.cameInAt <= toIso))
    .sort((a, b) =>
      view === "replied"
        ? (b.lastReplyAt ?? "").localeCompare(a.lastReplyAt ?? "")
        : view === "open"
          ? candidateIds.indexOf(a.contact.id) - candidateIds.indexOf(b.contact.id)
          : b.cameInAt.localeCompare(a.cameInAt),
    );

  // Grouped by day came in (report), day of the reply (replied), or one list (open).
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const key =
      view === "open"
        ? "open"
        : DateTime.fromISO(view === "replied" ? (row.lastReplyAt as string) : row.cameInAt)
            .setZone(org.timezone)
            .toISODate()!;
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }

  const count = (state: FirstContact["state"]) => rows.filter((row) => row.firstContact.state === state).length;
  const onTime = count("on_time");
  const late = count("late");
  const notContacted = count("overdue");
  const contactedHours = rows.flatMap((row) =>
    row.firstContact.state === "on_time" || row.firstContact.state === "late" ? [row.firstContact.hours] : [],
  );
  const averageHours = contactedHours.length ? contactedHours.reduce((sum, hours) => sum + hours, 0) / contactedHours.length : null;
  const overdueFollowUps = rows.filter((row) => row.followUp.kind === "due" && row.followUp.daysOverdue > 0).length;
  // Leads still inside their 48 hours aren't counted for or against.
  const judged = onTime + late + notContacted;

  const who = staffId ? (staffNames.get(staffId) ?? staff.displayName) : "The whole club";
  const typeLabel = LEAD_TYPES.find((type) => type.value === leadType)?.label;
  const local = (iso: string, format: string) => DateTime.fromISO(iso).setZone(org.timezone).toFormat(format);
  const viewHref = (name: string) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value && key !== "view" && key !== "page") query.set(key, String(value));
    if (name !== "period") query.set("view", name);
    return `/dashboard/sales/lead-status${query.toString() ? `?${query.toString()}` : ""}`;
  };
  const pageHref = (target: number) => `${viewHref("open")}&page=${target}`;
  const pages = Math.max(1, Math.ceil(openTotal / PAGE_SIZE));

  return (
    <DashboardShell
      title="Lead Status"
      description={`${who}${typeLabel ? ` · ${typeLabel} leads` : ""} · ${
        view === "open"
          ? "every open lead, any date"
          : view === "replied"
            ? `replied in the last ${REPLY_DAYS} days`
            : `${period.from.toFormat("LLL d")} – ${period.to.toFormat("LLL d, yyyy")}`
      }`}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SalesFilters
            range={period.preset}
            start={period.start}
            end={period.end}
            seller={sellerParam}
            leadType={leadType ?? "all"}
            salespeople={isAdmin ? salespeople : null}
          />
          <AddLeadButton sources={(sourceRows ?? []).map((row) => row.label as string)} />
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
            {(
              [
                ["period", "By date range"],
                ["open", "Open leads"],
                ["replied", `Replied (${REPLY_DAYS} days)`],
              ] as const
            ).map(([name, label]) => (
              <Link
                key={name}
                href={viewHref(name)}
                className={`rounded-md px-3 py-1.5 ${view === name ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {label}
              </Link>
            ))}
          </div>
          {view === "open" ? (
            <span className="text-sm text-muted-foreground">
              {openTotal} open leads · page {page} of {pages}
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="ml-3 underline">
                  Previous
                </Link>
              ) : null}
              {page < pages ? (
                <Link href={pageHref(page + 1)} className="ml-3 underline">
                  Next
                </Link>
              ) : null}
            </span>
          ) : view === "replied" ? (
            <span className="text-sm text-muted-foreground">Leads who texted, emailed or used a website form, newest reply first.</span>
          ) : (
            <span className="text-sm text-muted-foreground">The time frame filter applies to this view.</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Leads" value={String(view === "open" ? openTotal : rows.length)} />
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
                <TableHead>{view === "replied" ? "Replied" : "Came in"}</TableHead>
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
                    {view === "replied"
                      ? `Nobody replied in the last ${REPLY_DAYS} days.`
                      : view === "open"
                        ? "No open leads."
                        : "No leads came in during this period."}
                  </TableCell>
                </TableRow>
              ) : (
                [...byDay.entries()].map(([day, dayRows]) => (
                  <Fragment key={day}>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={10} className="py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {day === "open"
                          ? "Follow-ups due first, then most recently active"
                          : DateTime.fromISO(day, { zone: org.timezone }).toFormat("cccc, LLL d")}{" "}
                        · {dayRows.length} {dayRows.length === 1 ? "lead" : "leads"}
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
                          {view === "replied" && row.lastReplyAt
                            ? local(row.lastReplyAt, "h:mm a")
                            : local(row.cameInAt, view === "open" ? "LLL d, yyyy" : "h:mm a")}
                          <span className="ml-1 text-xs">{view === "replied" ? "reply" : row.visited ? "visit" : "added"}</span>
                        </TableCell>
                        <TableCell>
                          {row.contact.assigned_staff_id ? (staffNames.get(row.contact.assigned_staff_id) ?? "—") : "Unassigned"}
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
            Time to first contact runs from a guest&apos;s first visit (or from when they were added, if they haven&apos;t visited) to the
            first text, email or logged call after it. The goal is {FIRST_CONTACT_HOURS} hours. Calls, texts and emails count everything
            sent to the guest, by anyone.
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
