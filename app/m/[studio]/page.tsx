import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadPublicSchedule } from "@/lib/widget/schedule";
import { getCurrentMember } from "@/lib/member/session";
import { DateTime } from "luxon";
import { MapPin } from "lucide-react";
import { BookingClosed, MemberApp, MemberHeader, UUID, studioOr404 } from "./shell";
import { type MyBooking } from "./member-ui";
import { BookScreen } from "./book-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book a class", robots: { index: false, follow: false } };

type Props = { params: Promise<{ studio: string }>; searchParams: Promise<{ class?: string }> };

// The member app's Book screen (and its landing page). Opened from the
// website widget's Book buttons (new tab) or directly; ?class= opens that
// class's sheet.
export default async function MemberBookingPage({ params, searchParams }: Props) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const { class: classId } = await searchParams;
  const [schedule, member] = await Promise.all([loadPublicSchedule(studio.siteId), getCurrentMember(studio)]);
  if (!schedule) notFound();

  const bookings: Record<string, MyBooking> = {};
  if (member) {
    const admin = createSupabaseAdminClient();
    const ids = schedule.classes.map((item) => item.id);
    for (let index = 0; index < ids.length; index += 300) {
      const { data } = await admin
        .from("class_bookings")
        .select("id, class_session_id, status, spot_label")
        .eq("organization_id", studio.id)
        .eq("mindbody_client_id", member.mindbodyClientId)
        .in("status", ["booked", "waitlisted", "checked_in"])
        .in("class_session_id", ids.slice(index, index + 300));
      for (const row of data ?? [])
        bookings[row.class_session_id as string] = {
          id: row.id as string,
          status: row.status as MyBooking["status"],
          spotLabel: (row.spot_label as string | null) ?? null,
        };
    }
  }

  const today = DateTime.now().setZone(studio.timezone).toISODate()!;
  const screen = (
    <BookScreen
      schedule={schedule}
      studio={studio.siteId}
      signedIn={Boolean(member)}
      bookings={bookings}
      initialClassId={classId && UUID.test(classId) ? classId : undefined}
      today={today}
    />
  );
  const pin = <MapPin className="size-5 shrink-0" />;
  if (member) {
    return (
      <MemberApp studio={studio} title={studio.name} icon={pin} tab="book">
        {screen}
      </MemberApp>
    );
  }
  // Signed out: the schedule is open to browse; booking asks to sign in.
  return (
    <div className="min-h-screen bg-neutral-100 font-sans text-neutral-900">
      <MemberHeader
        studio={studio}
        title={studio.name}
        icon={pin}
        action={
          <Link
            href={`/m/${studio.siteId}/sign-in${classId && UUID.test(classId) ? `?class=${classId}` : ""}`}
            className="rounded-full bg-white/20 px-3 py-1 font-medium"
          >
            Sign in
          </Link>
        }
      />
      <main className="mx-auto max-w-md pb-10">{screen}</main>
    </div>
  );
}
