import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { ChevronRight, FileText } from "lucide-react";
import { getCurrentMember } from "@/lib/member/session";
import { listReceipts } from "@/lib/member/receipts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripeLivemode } from "@/lib/payments/connect";
import { CardUpdate } from "@/components/billing/card-update";
import { BookingClosed, MemberApp, MemberSection, studioOr404 } from "../shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Wallet", robots: { index: false, follow: false } };

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Wallet: the member's cards on file (dues + optional drinks & retail card,
// saved straight to Stripe), purchase history with PDF receipts, and signed
// agreements.
export default async function WalletPage({ params }: { params: Promise<{ studio: string }> }) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const member = await getCurrentMember(studio);
  if (!member) redirect(`/m/${studio.siteId}/sign-in`);
  const admin = createSupabaseAdminClient();
  const [receipts, { data: agreements }, { data: cards }, { data: overdue }] = await Promise.all([
    listReceipts({ organizationId: studio.id, mindbodyClientId: member.mindbodyClientId, timezone: studio.timezone }),
    admin
      .from("agreement_signatures")
      .select("id, title, signed_at")
      .eq("organization_id", studio.id)
      .eq("mindbody_client_id", member.mindbodyClientId)
      .order("signed_at", { ascending: false })
      .limit(100),
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
  const sections = [
    { purpose: "dues" as const, title: "Monthly dues", empty: "No card saved yet" },
    { purpose: "retail" as const, title: "Drinks & retail (optional)", empty: "None — purchases go on your dues card" },
  ];

  return (
    <MemberApp studio={studio} title="Wallet" tab="wallet">
      {overdue?.length ? (
        <p className="mx-4 mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          Your last membership payment didn&apos;t go through, so booking is paused. Add a new dues card and we&apos;ll try it right away.
        </p>
      ) : null}
      <MemberSection title="Payment methods">
        <ul className="divide-y px-4">
          {sections.map((section) => {
            const card = (cards ?? []).find((row) => row.purpose === section.purpose);
            const brand = card?.card_brand ? String(card.card_brand)[0].toUpperCase() + String(card.card_brand).slice(1) : "Card";
            return (
              <li key={section.purpose} className="space-y-3 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-12 items-center justify-center rounded-md border bg-neutral-50 text-[10px] font-bold tracking-wide text-neutral-600 uppercase">
                    {card?.card_brand ? String(card.card_brand).slice(0, 4) : "card"}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs tracking-wide text-neutral-500 uppercase">{section.title}</span>
                    <span className="block font-medium">{card?.card_last4 ? `${brand} •••• ${card.card_last4}` : section.empty}</span>
                    {card?.card_last4 ? (
                      <span className="block text-sm text-neutral-500">
                        {studio.name} · Expires {String(card.card_exp_month).padStart(2, "0")}/{card.card_exp_year}
                      </span>
                    ) : null}
                  </span>
                </div>
                <CardUpdate
                  endpoint="/api/member/card"
                  body={{ studio: studio.siteId, purpose: section.purpose }}
                  label={card?.card_last4 ? "Replace card" : "Add a card"}
                />
              </li>
            );
          })}
        </ul>
      </MemberSection>

      <MemberSection title="Purchase history">
        {receipts.length ? (
          <ul className="divide-y px-4">
            {receipts.map((receipt) => (
              <li key={`${receipt.kind}-${receipt.id}`}>
                <a
                  href={`/m/${studio.siteId}/receipts/${receipt.kind}/${receipt.id}`}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{receipt.description}</span>
                    <span className="text-sm text-neutral-500">
                      Purchased {DateTime.fromISO(receipt.date).toFormat("M/d/yy")}
                      {receipt.practice ? " · practice" : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 tabular-nums">
                    {money(receipt.totalCents)}
                    <ChevronRight className="size-4 text-neutral-400" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-sm text-neutral-500">
            No purchases yet. Purchases and monthly dues paid through {studio.name} show here.
          </p>
        )}
        <p className="px-4 pb-4 text-xs text-neutral-500">
          Tap a purchase for its PDF receipt. Purchases made before this app aren&apos;t listed.
        </p>
      </MemberSection>

      {agreements?.length ? (
        <MemberSection title="Agreements you signed">
          <ul className="divide-y px-4 pb-2">
            {agreements.map((agreement) => (
              <li key={agreement.id as string}>
                <a href={`/m/${studio.siteId}/agreements/${agreement.id}`} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="size-4 shrink-0 text-neutral-400" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{agreement.title as string}</span>
                      <span className="text-sm text-neutral-500">
                        Signed{" "}
                        {DateTime.fromISO(agreement.signed_at as string)
                          .setZone(studio.timezone)
                          .toFormat("LLL d, yyyy")}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-neutral-400" />
                </a>
              </li>
            ))}
          </ul>
        </MemberSection>
      ) : null}
    </MemberApp>
  );
}
