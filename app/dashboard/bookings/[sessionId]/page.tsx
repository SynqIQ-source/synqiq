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
import { canCheckIn, managesSales } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadSessionContext } from "@/lib/booking/context";
import { BOOKING_LABELS, bookingWindow, placeFor } from "@/lib/booking/rules";
import { BookSomeone, BookingRowActions } from "./booking-actions";

type Params = Promise<{ sessionId: string }>;

const STATUS_BADGE: Record<string, "secondary" | "outline" | "destructive"> = {
  booked: "outline",
  waitlisted: "outline",
  checked_in: "secondary",
  no_show: "destructive",
  late_cancelled: "destructive",
  cancelled: "outline",
};
const ORDER = ["checked_in", "booked", "no_show", "waitlisted", "late_cancelled", "cancelled"];
const money = (cents: number | null) => (cents ? `$${(cents / 100).toFixed(0)}` : null);

// One class on SynqIQ's calendar: book people in, waitlist, check-in,
// cancels (late inside the program's window).
export default async function BookingSessionPage({ params }: { params: Params }) {
  const staff = await requireAccess(canCheckIn);
  const { sessionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) notFound();
  const context = await loadSessionContext(staff.organizationId, sessionId);
  if (!context) notFound();
  const { session, rules, bookings, timezone } = context;
  const admin = createSupabaseAdminClient();
  const [{ data: room }, { data: teacher }, { data: occurrence }] = await Promise.all([
    session.roomId
      ? admin
          .from("rooms")
          .select("name")
          .eq("organization_id", staff.organizationId)
          .eq("mindbody_resource_id", session.roomId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    session.staffMindbodyId
      ? admin
          .from("staff")
          .select("display_name")
          .eq("organization_id", staff.organizationId)
          .eq("mindbody_staff_id", session.staffMindbodyId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    session.mindbodyClassScheduleId
      ? admin
          .from("class_occurrences")
          .select("id")
          .eq("organization_id", staff.organizationId)
          .eq("mindbody_class_schedule_id", session.mindbodyClassScheduleId)
          .eq("start_datetime", context.session.startsAt)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const start = DateTime.fromISO(session.startsAt).setZone(timezone);
  const end = DateTime.fromISO(session.endsAt).setZone(timezone);
  const now = new Date();
  const started = now.getTime() >= Date.parse(session.startsAt);
  const window = bookingWindow(session, rules, now, "staff");
  const spotOpen = placeFor(session, context.taken) === "booked";
  const sorted = [...bookings].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.booked_at.localeCompare(b.booked_at));
  const waitlist = bookings.filter((booking) => booking.status === "waitlisted").length;
  const synqiqIn = bookings.filter((booking) => booking.status === "booked" || booking.status === "checked_in").length;

  return (
    <DashboardShell
      title={session.className}
      description={`${start.toFormat("cccc, LLL d · h:mm a")}–${end.toFormat("h:mm a")}${teacher?.display_name ? ` · ${teacher.display_name}` : ""}${room?.name ? ` · ${room.name}` : ""}`}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/bookings?date=${session.localDate}`}>
            <ArrowLeft /> Bookings
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <Card className="py-4">
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Spots taken" value={`${context.taken}${session.capacity ? ` / ${session.capacity}` : ""}`} />
            <Stat label="In Mindbody" value={context.mindbodyBooked === null ? "—" : String(context.mindbodyBooked)} />
            <Stat label="In SynqIQ" value={String(synqiqIn)} />
            <Stat label="Waitlist (SynqIQ)" value={String(waitlist)} />
            <Stat
              label="Late cancel"
              value={`inside ${rules.cancelWindowMinutes ?? 0} min${money(rules.lateCancelFeeCents) ? ` · ${money(rules.lateCancelFeeCents)} fee` : ""}`}
            />
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{rules.name}</Badge>
          <Badge variant={rules.includedInMembership ? "secondary" : "outline"}>
            {rules.includedInMembership ? "Included in membership" : "Needs a pack"}
          </Badge>
          {!session.active ? <Badge variant="destructive">Cancelled</Badge> : null}
          {occurrence ? (
            <Link href={`/dashboard/classes/${occurrence.id}`} className="underline underline-offset-4">
              See Mindbody&apos;s roster
            </Link>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Book someone</CardTitle>
            <CardDescription>
              Booked if there&apos;s a spot, otherwise waitlisted. Membership covers{" "}
              {rules.includedInMembership ? "this class" : "other classes, not this one"}; packs cover their own program. Stays in SynqIQ
              until the switch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BookSomeone sessionId={session.id} open={window.open} />
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Booked in SynqIQ</CardTitle>
          </CardHeader>
          {sorted.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No SynqIQ bookings yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Covered by</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((booking) => (
                    <TableRow
                      key={booking.id}
                      className={["cancelled", "late_cancelled"].includes(booking.status) ? "text-muted-foreground" : undefined}
                    >
                      <TableCell>
                        <span className="font-medium">{booking.client_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          Booked {DateTime.fromISO(booking.booked_at).setZone(timezone).toFormat("LLL d, h:mm a")}
                          {booking.cancel_reason ? ` · ${booking.cancel_reason}` : ""}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[booking.status]}>{BOOKING_LABELS[booking.status]}</Badge>
                        {booking.status === "late_cancelled" && booking.late_cancel_fee_cents ? (
                          <span className="block text-xs">{money(booking.late_cancel_fee_cents)} fee (not charged yet)</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        {booking.coverage_kind === "none" ? (
                          <>
                            <Badge variant="destructive">Nothing</Badge>
                            {booking.note ? <span className="block text-xs text-muted-foreground">{booking.note}</span> : null}
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            {booking.coverage_kind === "membership" ? "Membership" : "Pack"} · {booking.coverage_name}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <BookingRowActions
                          id={booking.id}
                          status={booking.status}
                          started={started}
                          canWaive={managesSales(staff)}
                          spotOpen={spotOpen}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
