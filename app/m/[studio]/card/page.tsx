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
export const metadata: Metadata = { title: "Payment card", robots: { index: false, follow: false } };

// The member's card on file for monthly membership payments: see which card
// it is and replace it. The card goes from the app straight to Stripe.
export default async function MemberCardPage({ params }: { params: Promise<{ studio: string }> }) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const member = await getCurrentMember(studio);
  if (!member) redirect(`/m/${studio.siteId}/sign-in`);
  const admin = createSupabaseAdminClient();
  const [{ data: card }, { data: overdue }] = await Promise.all([
    admin
      .from("member_cards")
      .select("card_brand, card_last4, card_exp_month, card_exp_year")
      .eq("organization_id", studio.id)
      .eq("mindbody_client_id", member.mindbodyClientId)
      .eq("livemode", stripeLivemode())
      .maybeSingle(),
    admin
      .from("membership_charges")
      .select("id")
      .eq("organization_id", studio.id)
      .eq("mindbody_client_id", member.mindbodyClientId)
      .in("status", ["declined", "failed"])
      .limit(1),
  ]);
  const brand = card?.card_brand ? String(card.card_brand)[0].toUpperCase() + String(card.card_brand).slice(1) : "Card";

  return (
    <MemberShell studio={studio} title="Payment card">
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
            Your last membership payment didn&apos;t go through, so booking is paused. Add a new card and we&apos;ll try it right away.
          </p>
        ) : null}
        <div className="rounded-lg border px-3 py-3">
          <p className="text-sm text-neutral-600">Card on file for monthly payments</p>
          <p className="font-medium">
            {card?.card_last4
              ? `${brand} ending ${card.card_last4} · expires ${String(card.card_exp_month).padStart(2, "0")}/${card.card_exp_year}`
              : "No card saved in the app yet"}
          </p>
        </div>
        <CardUpdate
          endpoint="/api/member/card"
          body={{ studio: studio.siteId }}
          label={card?.card_last4 ? "Replace my card" : "Add my card"}
        />
      </div>
    </MemberShell>
  );
}
