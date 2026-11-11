import type { Metadata } from "next";
import { loadPublicSchedule } from "@/lib/widget/schedule";
import { findStudio } from "@/lib/member/session";
import { ScheduleWidget } from "./schedule-widget";

// Public class schedule for a studio's website (embedded with an iframe):
// /widget/schedule?studio=<mindbody site id>. No member data. Book buttons
// (opening the member booking page in a new tab) show once member booking
// is open to everyone, or with &booking=1 for testing during the parallel run.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Class schedule", robots: { index: false, follow: false } };

export default async function WidgetSchedulePage({ searchParams }: { searchParams: Promise<{ studio?: string; booking?: string }> }) {
  const { studio, booking } = await searchParams;
  const siteId = Number(studio);
  const valid = Number.isInteger(siteId) && siteId > 0;
  const [schedule, studioRow] = valid ? await Promise.all([loadPublicSchedule(siteId), findStudio(siteId)]) : [null, null];
  if (!schedule || !studioRow) {
    return <p style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>This schedule isn&apos;t available.</p>;
  }
  const bookable = studioRow.mode === "open" || (studioRow.mode === "testers" && booking === "1");
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://synqiq.co").replace(/\/$/, "");
  return (
    <ScheduleWidget
      schedule={schedule}
      bookingHref={bookable ? `${siteUrl}/m/${siteId}` : undefined}
      footer={bookable ? "Tap a class to book. You'll sign in on the next page." : undefined}
    />
  );
}
