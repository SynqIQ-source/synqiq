import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ArrowLeft } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { requireModule } from "@/lib/modules";
import { canCheckIn, isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { asOccurrenceId } from "@/lib/mindbody/types";
import { ROSTER_LABELS, buildRoster, rosterCounts, type MindbodyRosterVisit, type RosterEntry } from "@/lib/classes/roster";
import { loadSessionContext, type BookingRow } from "@/lib/booking/context";
import { BOOKING_LABELS, bookingWindow, cancellationFor, placeFor } from "@/lib/booking/rules";
import { BookSomeone, BookingRowActions } from "./booking-actions";
import { SpotBoard } from "./spot-board";

type Params = Promise<{ occurrenceId: string }>;

type Occurrence = {
  id: string;
  class_name: string | null;
  start_datetime: string;
  end_datetime: string | null;
  max_capacity: number | null;
  mindbody_occurrence_id: number | null;
  mindbody_class_schedule_id: number | null;
  instructor_name: string | null;
  staff: { display_name: string } | null;
  room: { name: string } | null;
};

const MB_BADGE: Record<RosterEntry["status"], "secondary" | "outline" | "destructive"> = {
  checked_in: "secondary",
  booked: "outline",
  no_show: "destructive",
  late_cancel: "destructive",
};
const SYNQ_BADGE: Record<BookingRow["status"], "secondary" | "outline" | "destructive"> = {
  booked: "outline",
  waitlisted: "outline",
  checked_in: "secondary",
  no_show: "destructive",
  late_cancelled: "destructive",
  cancelled: "outline",
};
const SYNQ_ORDER = ["checked_in", "booked", "no_show", "late_cancelled", "cancelled"];
const money = (cents: number | null) => (cents ? `$${(cents / 100).toFixed(0)}` : null);

// One class: who's in it and booking people in. The id is Mindbody's class
// (from the Classes list) or SynqIQ's calendar entry (SynqIQ-only classes,
// old Bookings links). Mindbody's roster is read live and is read-only
// until the switch; SynqIQ's bookings sit next to it with the actions.
export default async function ClassPage({ params }: { params: Params }) {
  await requireModule("group_fitness");
  const staff = await requireAccess(() => true);
  const { occurrenceId: id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const admin = createSupabaseAdminClient();
  const orgId = staff.organizationId;

  const occurrenceSelect = `id, class_name, start_datetime, end_datetime, max_capacity, mindbody_occurrence_id, mindbody_class_schedule_id, instructor_name,
       staff:staff!class_occurrences_staff_id_fkey ( display_name ),
       room:rooms!class_occurrences_room_id_fkey ( name )`;
  const [{ data: org }, { data: byOccurrence }] = await Promise.all([
    admin.from("organizations").select("timezone, mindbody_site_id").eq("id", orgId).maybeSingle(),
    admin.from("class_occurrences").select(occurrenceSelect).eq("organization_id", orgId).eq("id", id).maybeSingle<Occurrence>(),
  ]);
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";

  // Match Mindbody's class with SynqIQ's calendar entry (same schedule and start).
  let occurrence = byOccurrence;
  let sessionId: string | null = null;
  if (occurrence) {
    if (occurrence.mindbody_class_schedule_id) {
      const { data: session } = await admin
        .from("class_sessions")
        .select("id")
        .eq("organization_id", orgId)
        .eq("mindbody_class_schedule_id", occurrence.mindbody_class_schedule_id)
        .eq("starts_at", occurrence.start_datetime)
        .maybeSingle();
      sessionId = (session?.id as string | undefined) ?? null;
    }
  } else {
    const { data: session } = await admin
      .from("class_sessions")
      .select("id, mindbody_class_schedule_id, starts_at")
      .eq("organization_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (!session) notFound();
    sessionId = session.id as string;
    if (session.mindbody_class_schedule_id) {
      const { data: match } = await admin
        .from("class_occurrences")
        .select(occurrenceSelect)
        .eq("organization_id", orgId)
        .eq("mindbody_class_schedule_id", session.mindbody_class_schedule_id)
        .eq("start_datetime", session.starts_at)
        .maybeSingle<Occurrence>();
      occurrence = match;
    }
  }
  const context = sessionId ? await loadSessionContext(orgId, sessionId) : null;

  // Mindbody's roster, live; the last synced one if Mindbody can't be reached.
  let visits: MindbodyRosterVisit[] = [];
  let live = false;
  let mindbodyWaitlist = 0;
  if (occurrence?.mindbody_occurrence_id && org?.mindbody_site_id) {
    try {
      const mindbody = createMindbodyClient({ siteId: String(org.mindbody_site_id) });
      const token = await mindbody.requireAccessToken();
      const response = (await mindbody.getClassVisits(asOccurrenceId(occurrence.mindbody_occurrence_id), token)) as {
        Class?: { Visits?: MindbodyRosterVisit[]; TotalBookedWaitlist?: number | null };
      };
      visits = response.Class?.Visits ?? [];
      mindbodyWaitlist = response.Class?.TotalBookedWaitlist ?? 0;
      live = true;
    } catch (error) {
      console.error("[class-roster] live roster failed:", error instanceof Error ? error.message : error);
    }
    if (!live) {
      const { data: stored } = await admin
        .from("class_visits")
        .select("client_mindbody_unique_id, signed_in")
        .eq("occurrence_id", occurrence.id);
      visits = (stored ?? []).map((row) => ({ ClientUniqueId: Number(row.client_mindbody_unique_id), SignedIn: row.signed_in as boolean }));
    }
  }
  const uniqueIds = [...new Set(visits.map((visit) => visit.ClientUniqueId).filter((value): value is number => typeof value === "number"))];
  const { data: clients } = uniqueIds.length
    ? await admin
        .from("clients")
        .select("mindbody_unique_id, mindbody_client_id, first_name, last_name, status")
        .eq("organization_id", orgId)
        .in("mindbody_unique_id", uniqueIds)
    : { data: [] };
  const clientByUnique = new Map((clients ?? []).map((client) => [Number(client.mindbody_unique_id), client]));
  // Mindbody flags bookings as missed before the class happens; that only
  // means "not checked in" once it has started.
  const classStarted = Date.now() >= Date.parse(occurrence?.start_datetime ?? "") || false;
  if (!classStarted) visits = visits.map((visit) => ({ ...visit, Missed: false }));
  const roster = buildRoster(visits, (visit) => {
    const client = visit.ClientUniqueId ? clientByUnique.get(visit.ClientUniqueId) : undefined;
    return client ? `${client.first_name} ${client.last_name}`.trim() : "Client not synced yet";
  });
  const mb = rosterCounts(roster);

  // Header details: Mindbody's class, or SynqIQ's entry for SynqIQ-only classes.
  let title = occurrence?.class_name?.trim() || context?.session.className || "Class";
  let startIso = occurrence?.start_datetime ?? context?.session.startsAt ?? "";
  let endIso = occurrence?.end_datetime ?? context?.session.endsAt ?? null;
  let instructor = occurrence?.staff?.display_name ?? occurrence?.instructor_name ?? null;
  let roomName = occurrence?.room?.name ?? null;
  if (context) {
    // SynqIQ's single-date edits (time, teacher, room) win.
    title = occurrence?.class_name?.trim() || context.session.className;
    startIso = context.session.startsAt;
    endIso = context.session.endsAt;
    const [{ data: teacher }, { data: room }] = await Promise.all([
      context.session.staffMindbodyId
        ? admin
            .from("staff")
            .select("display_name")
            .eq("organization_id", orgId)
            .eq("mindbody_staff_id", context.session.staffMindbodyId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      context.session.roomId
        ? admin.from("rooms").select("name").eq("organization_id", orgId).eq("mindbody_resource_id", context.session.roomId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    instructor = (teacher?.display_name as string | undefined) ?? instructor;
    roomName = (room?.name as string | undefined) ?? roomName;
  }
  const start = DateTime.fromISO(startIso).setZone(timezone);
  const end = endIso ? DateTime.fromISO(endIso).setZone(timezone) : null;
  const now = new Date();
  const isPast = (end ?? start) < DateTime.now();
  const started = now.getTime() >= start.toMillis();

  // SynqIQ's bookings.
  const bookings = context?.bookings ?? [];
  const inClass = bookings
    .filter((booking) => booking.status !== "waitlisted")
    .sort((a, b) => SYNQ_ORDER.indexOf(a.status) - SYNQ_ORDER.indexOf(b.status) || a.booked_at.localeCompare(b.booked_at));
  const waitlisted = bookings
    .filter((booking) => booking.status === "waitlisted")
    .sort((a, b) => (a.waitlisted_at ?? a.booked_at).localeCompare(b.waitlisted_at ?? b.booked_at));
  const synq = {
    active: bookings.filter((booking) => booking.status === "booked" || booking.status === "checked_in").length,
    checkedIn: bookings.filter((booking) => booking.status === "checked_in").length,
    booked: bookings.filter((booking) => booking.status === "booked" || booking.status === "no_show").length,
    late: bookings.filter((booking) => booking.status === "late_cancelled").length,
  };
  const capacity = context?.session.capacity ?? occurrence?.max_capacity ?? null;
  const mindbodyIn = live ? mb.inClass : (context?.mindbodyBooked ?? mb.inClass);
  const taken = mindbodyIn + synq.active;
  const manage = canCheckIn(staff);
  const window = context ? bookingWindow(context.session, context.rules, now, "staff") : null;
  const spotOpen = context ? placeFor(context.session, taken) === "booked" : false;
  const lateNow = context ? cancellationFor(context.session, context.rules, now).status === "late_cancelled" : false;
  const feeLabel = context ? money(context.rules.lateCancelFeeCents) : null;
  const memberLink = (mindbodyClientId: string | null | undefined) =>
    isClubAdmin(staff) && mindbodyClientId ? `/dashboard/memberships/${mindbodyClientId}` : null;
  const rowCount = roster.length + inClass.length;

  return (
    <DashboardShell
      title={title}
      description={`${start.toFormat("cccc, LLL d · h:mm a")}${end ? `–${end.toFormat("h:mm a")}` : ""} · ${instructor ?? "Unassigned"}${
        roomName ? ` · ${roomName}` : ""
      }`}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/classes?viewMode=day&date=${start.toISODate()}`}>
            <ArrowLeft /> Classes
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <Card className="py-4">
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="In class" value={`${taken}${capacity ? ` / ${capacity}` : ""}`} />
            <Stat label="Checked in" value={String(mb.checked_in + synq.checkedIn)} />
            <Stat label={isPast ? "Booked, not checked in" : "Booked"} value={String(mb.booked + mb.no_show + synq.booked)} />
            <Stat label="Late cancels" value={String(mb.late_cancel + synq.late)} />
            <Stat label="Waitlist" value={String((live ? mindbodyWaitlist : 0) + waitlisted.length)} />
          </CardContent>
        </Card>

        {context ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{context.rules.name}</Badge>
            <Badge variant={context.rules.includedInMembership ? "secondary" : "outline"}>
              {context.rules.includedInMembership ? "Included in membership" : "Needs a pack"}
            </Badge>
            <span>
              Late cancel inside {context.rules.cancelWindowMinutes ?? 0} min{feeLabel ? ` · ${feeLabel} fee` : ""}
            </span>
            {!context.session.active ? <Badge variant="destructive">Cancelled</Badge> : null}
          </div>
        ) : null}

        {manage && context && window ? (
          <Card>
            <CardHeader>
              <CardTitle>Book someone</CardTitle>
              <CardDescription>
                Booked if there&apos;s a spot, otherwise waitlisted. If nothing covers the class, or the class is over, add a reason to book
                anyway. Stays in SynqIQ until the switch; Mindbody isn&apos;t changed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BookSomeone sessionId={context.session.id} open={window.open || Boolean(!window.open && window.overridable)} />
            </CardContent>
          </Card>
        ) : null}

        {context?.layout ? (
          <Card>
            <CardHeader>
              <CardTitle>The room</CardTitle>
              <CardDescription>
                Members pick their {context.layout.spotNoun.toLowerCase()} when they book; staff bookings get the next free one.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SpotBoard
                layout={context.layout}
                manage={Boolean(manage)}
                holders={context.bookings
                  .filter((booking) => booking.spot_id && (booking.status === "booked" || booking.status === "checked_in"))
                  .map((booking) => {
                    const [first, ...rest] = booking.client_name.split(" ");
                    const last = rest.length ? ` ${rest[rest.length - 1].charAt(0)}.` : "";
                    return { bookingId: booking.id, spotId: booking.spot_id as string, name: `${first}${last}` };
                  })}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Who&apos;s in this class</CardTitle>
            <CardDescription>
              {occurrence?.mindbody_occurrence_id
                ? live
                  ? "Mindbody's bookings are live from Mindbody and change there until the switch. SynqIQ bookings can be changed here."
                  : "Mindbody couldn't be reached, so its part is the last synced roster (check-ins only)."
                : "SynqIQ-only class."}
            </CardDescription>
          </CardHeader>
          {rowCount === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Nobody booked.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Covered by</TableHead>
                    <TableHead>Booked in</TableHead>
                    {manage ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inClass.map((booking) => {
                    const link = memberLink(booking.mindbody_client_id);
                    return (
                      <TableRow
                        key={booking.id}
                        className={["cancelled", "late_cancelled"].includes(booking.status) ? "text-muted-foreground" : undefined}
                      >
                        <TableCell>
                          <PersonName name={booking.client_name} href={link} />
                          <span className="block text-xs text-muted-foreground">
                            Booked {DateTime.fromISO(booking.booked_at).setZone(timezone).toFormat("LLL d, h:mm a")}
                            {booking.cancel_reason ? ` · ${booking.cancel_reason}` : booking.note ? ` · ${booking.note}` : ""}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={SYNQ_BADGE[booking.status]}>
                            {booking.status === "booked" && isPast ? "Not checked in" : BOOKING_LABELS[booking.status]}
                          </Badge>
                          {booking.spot_label && (booking.status === "booked" || booking.status === "checked_in") ? (
                            <Badge variant="outline" className="ml-1">
                              {booking.spot_label}
                            </Badge>
                          ) : null}
                          {booking.status === "late_cancelled" && booking.late_cancel_fee_cents ? (
                            <span className="block text-xs">{money(booking.late_cancel_fee_cents)} fee (not charged yet)</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {booking.coverage_kind === "none" ? (
                            <Badge variant="destructive">Nothing</Badge>
                          ) : (
                            <span className="text-muted-foreground">
                              {booking.coverage_kind === "membership" ? "Membership" : "Pack"} · {booking.coverage_name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">SynqIQ{booking.booked_by_member_account_id ? " · online" : ""}</Badge>
                        </TableCell>
                        {manage ? (
                          <TableCell className="text-right">
                            <BookingRowActions
                              id={booking.id}
                              status={booking.status}
                              started={started}
                              canWaive
                              spotOpen={spotOpen}
                              lateNow={lateNow}
                              feeLabel={feeLabel}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                  {roster.map((entry, index) => {
                    const client = entry.uniqueId ? clientByUnique.get(entry.uniqueId) : undefined;
                    return (
                      <TableRow key={`mb-${entry.uniqueId ?? index}`}>
                        <TableCell>
                          <PersonName name={entry.name} href={memberLink(client?.mindbody_client_id as string | undefined)} />
                          {client?.status && client.status !== "Active" ? (
                            <span className="block text-xs text-muted-foreground">{client.status}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={MB_BADGE[entry.status]}>
                            {entry.status === "booked" && isPast ? "Not checked in" : ROSTER_LABELS[entry.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{entry.paidWith ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">Mindbody{live ? (entry.bookedOnline ? " · online" : " · staff") : ""}</Badge>
                        </TableCell>
                        {manage ? <TableCell className="text-right text-xs text-muted-foreground">In Mindbody</TableCell> : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {waitlisted.length || (live && mindbodyWaitlist) ? (
          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle>Waitlist</CardTitle>
              <CardDescription>
                In order of joining.{" "}
                {spotOpen
                  ? "There's a spot open: move the next person in."
                  : "The class is full; staff can still move someone in over capacity."}
                {live && mindbodyWaitlist ? ` Mindbody also has ${mindbodyWaitlist} on its own waitlist.` : ""}
              </CardDescription>
            </CardHeader>
            {waitlisted.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    {waitlisted.map((booking, index) => (
                      <TableRow key={booking.id}>
                        <TableCell className="w-10 text-muted-foreground tabular-nums">{index + 1}</TableCell>
                        <TableCell>
                          <PersonName name={booking.client_name} href={memberLink(booking.mindbody_client_id)} />
                          <span className="block text-xs text-muted-foreground">
                            Joined{" "}
                            {DateTime.fromISO(booking.waitlisted_at ?? booking.booked_at)
                              .setZone(timezone)
                              .toFormat("LLL d, h:mm a")}
                          </span>
                        </TableCell>
                        {manage ? (
                          <TableCell className="text-right">
                            <BookingRowActions
                              id={booking.id}
                              status={booking.status}
                              started={started}
                              canWaive
                              spotOpen={spotOpen}
                              lateNow={false}
                              feeLabel={null}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Nobody on SynqIQ&apos;s waitlist.</p>
            )}
          </Card>
        ) : null}
      </div>
    </DashboardShell>
  );
}

function PersonName({ name, href }: { name: string; href: string | null }) {
  return href ? (
    <Link href={href} className="font-medium underline-offset-4 hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
