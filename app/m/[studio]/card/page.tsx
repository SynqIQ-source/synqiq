import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/member/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripeLivemode } from "@/lib/payments/connect";
import { CardUpdate } from "@/components/billing/card-update";
import { BookingClosed, MemberShell, studioOr404 } from "../shell";
import { SignOutButton } from "../member-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment cards", robots: { index: false, follow: false } };

// The member's cards on file: one for monthly dues and an optional separate
// one for purchases at the club (drinks, retail). The card goes from the app
// straight to Stripe.
export default async function MemberCardPage({ params }: { params: Promise<{ studio: string }> }) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const member = await getCurrentMember(studio);
  if (!member) redirect(`/m/${studio.siteId}/sign-in`);
  const admin = createSupabaseAdminClient();
  const [{ data: cards }, { data: overdue }] = await Promise.all([
    admin
      .from("member_cards")
      .select("purpose, card_brand, card_last4, card_exp_month, card_exp_year")
      .eq("organization_id", studio.id)
      .eq("mindbody_client_id", member.mindbodyClientId)
      .eq("livemode", stripeLivemode()),
    admin
      .from("membership_charges")
      .select("id")
      .eq("organization_id", studio.id)
      .eq("mindbody_client_id", member.mindbodyClientId)
      .in("status", ["declined", "failed"])
      .limit(1),
  ]);
  const describe = (purpose: "dues" | "retail") => {
    const card = (cards ?? []).find((row) => row.purpose === purpose);
    if (!card?.card_last4) return null;
    const brand = card.card_brand ? String(card.card_brand)[0].toUpperCase() + String(card.card_brand).slice(1) : "Card";
    return `${brand} ending ${card.card_last4} · expires ${String(card.card_exp_month).padStart(2, "0")}/${card.card_exp_year}`;
  };
  const sections = [
    { purpose: "dues" as const, title: "Monthly dues", empty: "No card saved in the app yet", card: describe("dues") },
    {
      purpose: "retail" as const,
      title: "Drinks & retail (optional)",
      empty: "None. Purchases go on your dues card unless you add one.",
      card: describe("retail"),
    },
  ];

  return (
    <MemberShell studio={studio} title="Payment cards">
      <div className="mb-4 flex justify-between text-sm">
        <span className="flex gap-3">
          <Link href={`/m/${studio.siteId}`} className="underline underline-offset-4">
            Book a class
          </Link>
          <Link href={`/m/${studio.siteId}/receipts`} className="underline underline-offset-4">
            Receipts
          </Link>
        </span>
        <SignOutButton />
      </div>
      <div className="space-y-4">
        {overdue?.length ? (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            Your last membership payment didn&apos;t go through, so booking is paused. Add a new dues card and we&apos;ll try it right away.
          </p>
        ) : null}
        {sections.map((section) => (
          <div key={section.purpose} className="space-y-3 rounded-lg border px-3 py-3">
            <div>
              <p className="text-sm text-neutral-600">{section.title}</p>
              <p className="font-medium">{section.card ?? section.empty}</p>
            </div>
            <CardUpdate
              endpoint="/api/member/card"
              body={{ studio: studio.siteId, purpose: section.purpose }}
              label={section.card ? "Replace card" : "Add card"}
            />
          </div>
        ))}
      </div>
    </MemberShell>
  );
}
