import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { ChevronRight } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentMember } from "@/lib/member/session";
import { BookingClosed, MemberApp, MemberSection, studioOr404 } from "../shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My schedule", robots: { index: false, follow: false } };

const LABELS: Record<string, string> = {
  booked: "Booked",
  waitlisted: "Waitlist",
  checked_in: "Checked in",
  no_show: "Missed",
  cancelled: "Cancelled",
  late_cancelled: "Late cancel",
};

type Row = {
  id: string;
  status: string;
  late_cancel_fee_cents: number | null;
  spot_label: string | null;
  session: { id: string; class_name: string; starts_at: string };
};

// A member's upcoming classes (tap one to open it on the Book screen, where it
// can be cancelled) and the last 30 days.
export default async function MyClassesPage({ params }: { params: Promise<{ studio: string }> }) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const member = await getCurrentMember(studio);
  if (!member) redirect(`/m/${studio.siteId}/sign-in`);
  const { data } = await createSupabaseAdminClient()
    .from("class_bookings")
    .select("id, status, late_cancel_fee_cents, spot_label, session:class_sessions!inner ( id, class_name, starts_at )")
    .eq("organization_id", studio.id)
    .eq("mindbody_client_id", member.mindbodyClientId)
    .gte("session.starts_at", DateTime.now().minus({ days: 30 }).toUTC().toISO()!)
    .returns<Row[]>();
  const rows = (data ?? []).sort((a, b) => a.session.starts_at.localeCompare(b.session.starts_at));
  const now = Date.now();
  const upcoming = rows.filter((row) => Date.parse(row.session.starts_at) >= now && ["booked", "waitlisted"].includes(row.status));
  const past = rows.filter((row) => !upcoming.includes(row)).reverse();
  const day = (iso: string) => DateTime.fromISO(iso).setZone(studio.timezone);

  return (
    <MemberApp studio={studio} title="My schedule" tab="schedule">
      <MemberSection title="Coming up">
        {upcoming.length ? (
          <ul className="divide-y px-4">
            {upcoming.map((row) => (
              <li key={row.id}>
                <Link href={`/m/${studio.siteId}?class=${row.session.id}`} className="flex items-center gap-3 py-3">
                  <span
                    className="flex w-12 shrink-0 flex-col items-center rounded-lg py-1 text-white"
                    style={{ background: studio.primaryColor }}
                  >
                    <span className="text-[10px] uppercase">{day(row.session.starts_at).toFormat("LLL")}</span>
                    <span className="text-lg leading-none font-semibold">{day(row.session.starts_at).toFormat("d")}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{row.session.class_name}</span>
                    <span className="text-sm text-neutral-600">
                      {day(row.session.starts_at).toFormat("cccc · h:mm a")}
                      {row.spot_label ? ` · ${row.spot_label}` : ""}
                    </span>
                  </span>
                  <span className="text-xs font-medium">{LABELS[row.status]}</span>
                  <ChevronRight className="size-4 text-neutral-400" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 pb-5">
            <p className="text-sm text-neutral-500">Nothing booked yet.</p>
            <Link
              href={`/m/${studio.siteId}`}
              className="mt-3 inline-flex h-11 items-center rounded-xl px-5 font-medium text-white"
              style={{ background: studio.primaryColor }}
            >
              Book a class
            </Link>
          </div>
        )}
      </MemberSection>
      <MemberSection title="Last 30 days">
        {past.length ? (
          <ul className="divide-y px-4">
            {past.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                <span>
                  <span className="block font-medium">{row.session.class_name}</span>
                  <span className="text-sm text-neutral-500">{day(row.session.starts_at).toFormat("ccc, LLL d · h:mm a")}</span>
                </span>
                <span className="text-right text-xs">
                  {LABELS[row.status] ?? row.status}
                  {row.status === "late_cancelled" && row.late_cancel_fee_cents ? (
                    <span className="block text-neutral-500">${(row.late_cancel_fee_cents / 100).toFixed(0)} fee</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-sm text-neutral-500">Nothing in the last 30 days.</p>
        )}
      </MemberSection>
      <p className="px-4 py-4 text-xs text-neutral-500">
        Classes booked at the front desk before online booking started may not show here yet.
      </p>
    </MemberApp>
  );
}
