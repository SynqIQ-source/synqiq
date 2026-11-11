import type { Metadata } from "next";
import { loadPublicSchedule } from "@/lib/widget/schedule";
import { ScheduleWidget } from "./schedule-widget";

// Public class schedule for a studio's website (embedded with an iframe):
// /widget/schedule?studio=<mindbody site id>. View-only; no login, no
// member data.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Class schedule", robots: { index: false, follow: false } };

export default async function WidgetSchedulePage({ searchParams }: { searchParams: Promise<{ studio?: string }> }) {
  const { studio } = await searchParams;
  const siteId = Number(studio);
  const schedule = Number.isInteger(siteId) && siteId > 0 ? await loadPublicSchedule(siteId) : null;
  if (!schedule) {
    return <p style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>This schedule isn&apos;t available.</p>;
  }
  return <ScheduleWidget schedule={schedule} />;
}
