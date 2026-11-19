import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadSessionContext } from "@/lib/booking/context";

// Checking into the club also checks the member into their SynqIQ
// reservations that start within the next hour (or are under way): classes
// and pool lanes, which are both class bookings. Personal training sessions
// are separate and are never checked in this way -- trainers do those.
// Mindbody's own reservations are left to Mindbody.

export const AUTO_CHECK_IN_MINUTES = 60;

// Reservations due: starting within `minutes` from now, or started and not
// yet over.
export function dueForAutoCheckIn<T extends { startsAt: string; endsAt: string }>(
  reservations: T[],
  now: Date,
  minutes = AUTO_CHECK_IN_MINUTES,
): T[] {
  const time = now.getTime();
  return reservations.filter((reservation) => {
    const start = Date.parse(reservation.startsAt);
    const end = Date.parse(reservation.endsAt);
    return start - time <= minutes * 60_000 && time < end;
  });
}

export type AutoCheckedIn = { bookingId: string; className: string; startsAt: string };

export async function autoCheckInReservations(input: {
  organizationId: string;
  mindbodyClientId: string;
  staffId: string;
  timezone: string;
  now?: Date;
}): Promise<AutoCheckedIn[]> {
  const admin = createSupabaseAdminClient();
  const now = input.now ?? new Date();
  const today = DateTime.fromJSDate(now).setZone(input.timezone).toISODate()!;
  const { data: bookings } = await admin
    .from("class_bookings")
    .select("id, class_session_id, session:class_sessions!inner ( local_date )")
    .eq("organization_id", input.organizationId)
    .eq("mindbody_client_id", input.mindbodyClientId)
    .eq("status", "booked")
    .eq("session.local_date", today);
  if (!bookings?.length) return [];

  // Times from the session context, so single-date time changes count.
  const withTimes = (
    await Promise.all(
      bookings.map(async (booking) => {
        const context = await loadSessionContext(input.organizationId, booking.class_session_id as string);
        return context
          ? {
              bookingId: booking.id as string,
              className: context.session.className,
              startsAt: context.session.startsAt,
              endsAt: context.session.endsAt,
            }
          : null;
      }),
    )
  ).filter((row): row is AutoCheckedIn & { endsAt: string } => row !== null);

  const due = dueForAutoCheckIn(withTimes, now);
  const done: AutoCheckedIn[] = [];
  for (const reservation of due) {
    const { data } = await admin
      .from("class_bookings")
      .update({ status: "checked_in", checked_in_at: now.toISOString(), checked_in_by_staff_id: input.staffId })
      .eq("id", reservation.bookingId)
      .eq("status", "booked")
      .select("id");
    if (data?.length) done.push({ bookingId: reservation.bookingId, className: reservation.className, startsAt: reservation.startsAt });
  }
  return done;
}
