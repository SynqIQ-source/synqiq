import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getCurrentMember } from "@/lib/member/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { code128Widths } from "@/lib/member/barcode";
import { BookingClosed, MemberApp, MemberSection, studioOr404 } from "../shell";
import { SignOutButton } from "../member-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "More", robots: { index: false, follow: false } };

// More: the member's ID card (name, member ID and a barcode the front desk
// can scan like a key tag), shortcuts, and sign out.
export default async function MorePage({ params }: { params: Promise<{ studio: string }> }) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const member = await getCurrentMember(studio);
  if (!member) redirect(`/m/${studio.siteId}/sign-in`);
  const { data: memberships } = await createSupabaseAdminClient()
    .from("member_contracts")
    .select("contract_name, end_date, termination_date, start_date")
    .eq("organization_id", studio.id)
    .eq("mindbody_client_id", member.mindbodyClientId)
    .order("start_date", { ascending: false })
    .limit(20);
  const today = new Date().toISOString().slice(0, 10);
  const active = (memberships ?? []).filter(
    (row) =>
      (!row.end_date || (row.end_date as string) >= today) &&
      (!row.termination_date || (row.termination_date as string) > today) &&
      (!row.start_date || (row.start_date as string) <= today),
  );

  let x = 0;
  const bars = (/^[\x20-\x7e]{1,40}$/.test(member.mindbodyClientId) ? code128Widths(member.mindbodyClientId) : []).map((width, index) => {
    const bar = { x, width, dark: index % 2 === 0 };
    x += width;
    return bar;
  });

  return (
    <MemberApp studio={studio} title="More" tab="more">
      <div className="px-4 pt-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold">{member.name}</p>
              <p className="text-sm text-neutral-500">Member ID: {member.mindbodyClientId}</p>
            </div>
            {studio.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- studio logo
              <img src={studio.logoUrl} alt={studio.name} className="h-10 w-auto" />
            ) : (
              <span className="text-sm font-semibold" style={{ color: studio.primaryColor }}>
                {studio.name}
              </span>
            )}
          </div>
          {bars.length ? (
            <svg
              viewBox={`-10 0 ${x + 20} 60`}
              className="mt-4 h-20 w-full"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Barcode ${member.mindbodyClientId}`}
            >
              <rect x={-10} y={0} width={x + 20} height={60} fill="#fff" />
              {bars
                .filter((bar) => bar.dark)
                .map((bar) => (
                  <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={60} fill="#000" />
                ))}
            </svg>
          ) : null}
          <p className="mt-1 text-center font-mono text-sm tracking-widest">{member.mindbodyClientId}</p>
          <p className="mt-2 text-center text-xs text-neutral-500">Show this at the front desk to check in.</p>
        </div>
      </div>

      <MemberSection title="Memberships & passes">
        {active.length ? (
          <ul className="divide-y px-4 pb-2">
            {active.map((row, index) => (
              <li key={index} className="flex items-center justify-between gap-3 py-3">
                <span className="font-medium">{row.contract_name as string}</span>
                <span className="text-sm text-neutral-500">
                  {row.end_date
                    ? `Through ${new Date(`${row.end_date}T12:00:00`).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" })}`
                    : "Ongoing"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-sm text-neutral-500">No active memberships on file.</p>
        )}
      </MemberSection>

      <MemberSection>
        <ul className="divide-y px-4">
          {[
            { href: `/m/${studio.siteId}/my-classes`, label: "My schedule" },
            { href: `/m/${studio.siteId}/wallet`, label: "Payment methods & receipts" },
            { href: `/m/${studio.siteId}/get-link`, label: "Change my password" },
          ].map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="flex items-center justify-between py-4 text-base font-medium">
                {link.label}
                <ChevronRight className="size-5 text-neutral-400" />
              </Link>
            </li>
          ))}
        </ul>
      </MemberSection>

      <div className="py-8 text-center font-medium text-red-700">
        <SignOutButton />
      </div>
    </MemberApp>
  );
}
