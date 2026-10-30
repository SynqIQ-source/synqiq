import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { LeadTypeTag, OUTCOME_CHIP_CLASSES, OutcomeDot } from "@/components/crm/guest-tags";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  APPOINTMENT_OUTCOME_LABELS,
  appointmentOutcome,
  type AppointmentOutcome,
} from "@/lib/crm/labels";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { getScopedClient } from "@/lib/supabase/scoped";
import { cn } from "@/lib/utils";
import { CalendarSellerSelect } from "./calendar-seller-select";

export const dynamic = "force-dynamic";

const VIEWS = ["day", "week", "month"] as const;
type View = (typeof VIEWS)[number];
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_CHIPS = 3;
const OUTCOMES: AppointmentOutcome[] = ["scheduled", "no_show", "showed", "closed"];

type Appointment = {
  id: string;
  scheduled_at: string;
  status: string;
  staff_id: string | null;
  created_by_staff_id: string | null;
  contact: {
    id: string;
    first_name: string;
    last_name: string;
    source: string;
    referring_client_id: string | null;
    referrer_name_typed: string | null;
    assigned_staff_id: string | null;
    closed_at: string | null;
    deleted_at: string | null;
    merged_into_id: string | null;
  } | null;
};

type Entry = Appointment & { contact: NonNullable<Appointment["contact"]>; outcome: AppointmentOutcome; at: DateTime };

// Sales calendar: guests' appointments by day, week or month, colored by how
// they turned out (blue scheduled, grey no-show, red showed but not sold,
// green sold) with a lead-type tag next to each name. Canceled appointments
// are left off. Admins see the club or one salesperson (who the guest is
// meeting, else their assigned salesperson); salespeople see their own.
export default async function SalesCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; seller?: string }>;
}) {
  const staff = await requireCrmStaff();
  const params = await searchParams;
  const isAdmin = staff.role === "admin";
  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const now = DateTime.now().setZone(org.timezone);

  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : "week";
  const picked = params.date && DATE_PARAM.test(params.date) ? DateTime.fromISO(params.date, { zone: org.timezone }) : null;
  const anchor = (picked?.isValid ? picked : now).startOf("day");
  const sellerParam = isAdmin ? (params.seller ?? "all") : staff.id;

  // Visible range; the month view shows whole weeks (Monday first).
  const rangeStart =
    view === "day" ? anchor : view === "week" ? anchor.startOf("week") : anchor.startOf("month").startOf("week");
  const rangeEnd =
    view === "day" ? anchor.endOf("day") : view === "week" ? anchor.endOf("week") : anchor.endOf("month").endOf("week");
  const step = view === "day" ? { days: 1 } : view === "week" ? { weeks: 1 } : { months: 1 };

  const [appointmentsResult, staffResult] = await Promise.all([
    supabase
      .from("crm_appointments")
      .select(
        `id, scheduled_at, status, staff_id, created_by_staff_id,
         contact:crm_contacts!crm_appointments_contact_id_fkey ( id, first_name, last_name, source, referring_client_id, referrer_name_typed, assigned_staff_id, closed_at, deleted_at, merged_into_id )`,
      )
      .neq("status", "canceled")
      .gte("scheduled_at", rangeStart.toUTC().toISO()!)
      .lte("scheduled_at", rangeEnd.toUTC().toISO()!)
      .order("scheduled_at")
      .limit(2000)
      .returns<Appointment[]>(),
    supabase.from("staff").select("id, display_name, can_sell, role, archived_at").order("display_name"),
  ]);
  if (appointmentsResult.error) throw new Error("Failed to load appointments.");

  const staffRows = staffResult.data ?? [];
  const staffNames = new Map(staffRows.map((member) => [member.id, member.display_name as string]));
  const salespeople = staffRows
    .filter((member) => !member.archived_at && (member.can_sell || member.role === "admin"))
    .map((member) => ({ id: member.id, name: member.display_name as string }));

  const entries: Entry[] = (appointmentsResult.data ?? [])
    .filter((row): row is Appointment & { contact: Entry["contact"] } =>
      Boolean(row.contact && !row.contact.deleted_at && !row.contact.merged_into_id),
    )
    .filter((row) => sellerParam === "all" || (row.staff_id ?? row.contact.assigned_staff_id) === sellerParam)
    .map((row) => ({
      ...row,
      outcome: appointmentOutcome(row.status, row.contact.closed_at),
      at: DateTime.fromISO(row.scheduled_at).setZone(org.timezone),
    }));
  const byDay = new Map<string, Entry[]>();
  for (const entry of entries) {
    const day = entry.at.toISODate()!;
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }
  const counts = new Map<AppointmentOutcome, number>();
  for (const entry of entries) counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);

  const href = (changes: { view?: View; date?: string }) => {
    const query = new URLSearchParams({ view: changes.view ?? view, date: changes.date ?? anchor.toISODate()! });
    if (isAdmin && sellerParam !== "all") query.set("seller", sellerParam);
    return `/dashboard/sales/calendar?${query.toString()}`;
  };
  const days: DateTime[] = [];
  for (let day = rangeStart; day <= rangeEnd; day = day.plus({ days: 1 })) days.push(day);
  const today = now.toISODate();

  const title =
    view === "day"
      ? anchor.toFormat("cccc, LLLL d, yyyy")
      : view === "week"
        ? `${rangeStart.toFormat("LLL d")} – ${rangeEnd.toFormat(rangeStart.month === rangeEnd.month ? "d, yyyy" : "LLL d, yyyy")}`
        : anchor.toFormat("LLLL yyyy");
  const who = sellerParam === "all" ? "The whole club" : (staffNames.get(sellerParam) ?? staff.displayName);

  const chip = (entry: Entry, compact: boolean) => (
    <Link
      key={entry.id}
      href={`/dashboard/guests/${entry.contact.id}`}
      title={`${entry.contact.first_name} ${entry.contact.last_name} · ${entry.at.toFormat("h:mm a")} · ${
        APPOINTMENT_OUTCOME_LABELS[entry.outcome]
      }${entry.staff_id ? ` · with ${staffNames.get(entry.staff_id) ?? "staff"}` : ""}`}
      className={cn(
        "block rounded-md border px-1.5 py-1 text-xs leading-tight transition-opacity hover:opacity-80",
        OUTCOME_CHIP_CLASSES[entry.outcome],
      )}
    >
      <span className="flex items-center gap-1">
        <span className="shrink-0 tabular-nums opacity-75">{entry.at.toFormat(compact ? "h:mma" : "h:mm a").toLowerCase()}</span>
        <span className="truncate font-medium">
          {entry.contact.first_name} {compact ? `${entry.contact.last_name.slice(0, 1)}.` : entry.contact.last_name}
        </span>
        <LeadTypeTag contact={entry.contact} className="ml-auto shrink-0 border-current/30 text-current opacity-80" />
      </span>
      {!compact && entry.staff_id ? (
        <span className="mt-0.5 block truncate opacity-75">with {staffNames.get(entry.staff_id) ?? "staff"}</span>
      ) : null}
    </Link>
  );

  return (
    <DashboardShell
      title="Calendar"
      description={`${who} · ${title}`}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex rounded-md border bg-card p-0.5">
            {VIEWS.map((option) => (
              <Link
                key={option}
                href={href({ view: option })}
                className={cn(
                  "rounded px-2.5 py-1 text-sm capitalize",
                  option === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon-sm" aria-label="Previous">
              <Link href={href({ date: anchor.minus(step).toISODate()! })}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={href({ date: now.toISODate()! })}>Today</Link>
            </Button>
            <Button asChild variant="outline" size="icon-sm" aria-label="Next">
              <Link href={href({ date: anchor.plus(step).toISODate()! })}>
                <ChevronRight />
              </Link>
            </Button>
          </div>
          {isAdmin ? <CalendarSellerSelect seller={sellerParam} salespeople={salespeople} /> : null}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {OUTCOMES.map((outcome) => (
              <span key={outcome} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <OutcomeDot outcome={outcome} />
                {APPOINTMENT_OUTCOME_LABELS[outcome]}
                <span className="font-semibold text-foreground tabular-nums">{counts.get(outcome) ?? 0}</span>
              </span>
            ))}
          </div>
        </div>

        {view === "day" ? (
          <Card>
            <CardContent className="space-y-2">
              {(byDay.get(anchor.toISODate()!) ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No appointments this day.</p>
              ) : (
                (byDay.get(anchor.toISODate()!) ?? []).map((entry) => (
                  <div key={entry.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
                    {chip(entry, false)}
                    <p className="text-xs text-muted-foreground">
                      {APPOINTMENT_OUTCOME_LABELS[entry.outcome]}
                      {entry.created_by_staff_id ? ` · booked by ${staffNames.get(entry.created_by_staff_id) ?? "staff"}` : ""}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden py-0">
            <div className="hidden grid-cols-7 border-b bg-muted/40 text-xs font-medium tracking-wide text-muted-foreground uppercase sm:grid">
              {days.slice(0, 7).map((day) => (
                <div key={day.weekday} className="px-2 py-1.5">
                  {day.toFormat("ccc")}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-7">
              {days.map((day) => {
                const iso = day.toISODate()!;
                const dayEntries = byDay.get(iso) ?? [];
                const outside = view === "month" && day.month !== anchor.month;
                const shown = view === "month" ? dayEntries.slice(0, MONTH_CHIPS) : dayEntries;
                // On phones the month view lists only days with appointments.
                return (
                  <div
                    key={iso}
                    className={cn(
                      "space-y-1 border-b p-1.5 sm:border-r sm:[&:nth-child(7n)]:border-r-0",
                      view === "week" ? "sm:min-h-64" : "sm:min-h-28",
                      outside && "bg-muted/30",
                      view === "month" && dayEntries.length === 0 && "hidden sm:block",
                    )}
                  >
                    <Link
                      href={href({ view: "day", date: iso })}
                      className={cn(
                        "flex items-center gap-1.5 rounded px-1 text-xs font-medium hover:underline",
                        outside ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 tabular-nums",
                          iso === today && "bg-primary text-primary-foreground",
                        )}
                      >
                        {day.day}
                      </span>
                      <span className="sm:hidden">{day.toFormat("cccc, LLL d")}</span>
                    </Link>
                    {shown.map((entry) => chip(entry, view === "month"))}
                    {dayEntries.length > shown.length ? (
                      <Link
                        href={href({ view: "day", date: iso })}
                        className="block px-1 text-xs font-medium text-primary hover:underline"
                      >
                        +{dayEntries.length - shown.length} more
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
        <p className="text-xs text-muted-foreground">
          Tags: WI walk-in · GM guest of a member · REF referral · PH phone-in · WEB web lead · OTH other. Canceled
          appointments aren&apos;t shown. Click a guest to open their profile, or a date to see that day.
        </p>
      </div>
    </DashboardShell>
  );
}
