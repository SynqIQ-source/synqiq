import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentMember } from "@/lib/member/session";
import { BookingClosed, MemberShell, studioOr404 } from "../shell";
import { SignOutButton } from "../member-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My classes", robots: { index: false, follow: false } };

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
  session: { id: string; class_name: string; starts_at: string };
};

// A member's upcoming classes and the last 30 days.
export default async function MyClassesPage({ params }: { params: Promise<{ studio: string }> }) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const member = await getCurrentMember(studio);
  if (!member) redirect(`/m/${studio.siteId}/sign-in`);
  const { data } = await createSupabaseAdminClient()
    .from("class_bookings")
    .select("id, status, late_cancel_fee_cents, session:class_sessions!inner ( id, class_name, starts_at )")
    .eq("organization_id", studio.id)
    .eq("mindbody_client_id", member.mindbodyClientId)
    .gte("session.starts_at", DateTime.now().minus({ days: 30 }).toUTC().toISO()!)
    .returns<Row[]>();
  const rows = (data ?? []).sort((a, b) => a.session.starts_at.localeCompare(b.session.starts_at));
  const now = Date.now();
  const upcoming = rows.filter((row) => Date.parse(row.session.starts_at) >= now && ["booked", "waitlisted"].includes(row.status));
  const past = rows.filter((row) => !upcoming.includes(row)).reverse();
  const when = (iso: string) => DateTime.fromISO(iso).setZone(studio.timezone).toFormat("ccc, LLL d · h:mm a");

  return (
    <MemberShell studio={studio} title="My classes">
      <div className="mb-4 flex justify-between text-sm">
        <Link href={`/m/${studio.siteId}`} className="underline underline-offset-4">
          Book a class
        </Link>
        <SignOutButton />
      </div>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-neutral-500 uppercase">Coming up</h2>
      {upcoming.length ? (
        <ul className="mb-6 divide-y rounded-lg border">
          {upcoming.map((row) => (
            <li key={row.id}>
              <Link
                href={`/m/${studio.siteId}?class=${row.session.id}`}
                className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-neutral-50"
              >
                <span>
                  <span className="block font-medium">{row.session.class_name}</span>
                  <span className="text-sm text-neutral-600">{when(row.session.starts_at)}</span>
                </span>
                <span className="text-xs font-medium">{LABELS[row.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-sm text-neutral-600">Nothing booked yet.</p>
      )}
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-neutral-500 uppercase">Last 30 days</h2>
      {past.length ? (
        <ul className="divide-y rounded-lg border">
          {past.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <span>
                <span className="block font-medium">{row.session.class_name}</span>
                <span className="text-sm text-neutral-600">{when(row.session.starts_at)}</span>
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
        <p className="text-sm text-neutral-600">Nothing in the last 30 days.</p>
      )}
      <p className="mt-6 text-xs text-neutral-500">Classes booked at the front desk before online booking started may not show here yet.</p>
    </MemberShell>
  );
}
