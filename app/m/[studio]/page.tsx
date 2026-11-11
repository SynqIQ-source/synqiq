import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadPublicSchedule } from "@/lib/widget/schedule";
import { getCurrentMember } from "@/lib/member/session";
import { BookingClosed, UUID, studioOr404 } from "./shell";
import { MemberSchedule, SignOutButton, type MyBooking } from "./member-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book a class", robots: { index: false, follow: false } };

type Props = { params: Promise<{ studio: string }>; searchParams: Promise<{ class?: string }> };

// The member booking page: the schedule with Book / Cancel. Opened from the
// website widget's Book buttons (new tab) or directly.
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
        .select("id, class_session_id, status")
        .eq("organization_id", studio.id)
        .eq("mindbody_client_id", member.mindbodyClientId)
        .in("status", ["booked", "waitlisted", "checked_in"])
        .in("class_session_id", ids.slice(index, index + 300));
      for (const row of data ?? [])
        bookings[row.class_session_id as string] = { id: row.id as string, status: row.status as MyBooking["status"] };
    }
  }

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm">
      {member ? (
        <>
          <span>Hi {member.firstName}. Tap a class to book.</span>
          <span className="flex gap-3">
            <Link href={`/m/${studio.siteId}/my-classes`} className="underline underline-offset-4">
              My classes
            </Link>
            <SignOutButton />
          </span>
        </>
      ) : (
        <span>
          <Link
            href={`/m/${studio.siteId}/sign-in${classId && UUID.test(classId) ? `?class=${classId}` : ""}`}
            className="font-medium underline underline-offset-4"
          >
            Sign in
          </Link>{" "}
          to book a class.
        </span>
      )}
      {studio.mode === "testers" ? (
        <span className="w-full text-xs text-neutral-500">Online booking is being tested with a few members.</span>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <MemberSchedule
        schedule={schedule}
        studio={studio.siteId}
        signedIn={Boolean(member)}
        bookings={bookings}
        initialClassId={classId && UUID.test(classId) ? classId : undefined}
        header={header}
      />
    </div>
  );
}
