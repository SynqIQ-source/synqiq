import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getCurrentMember } from "@/lib/member/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { onlineItems, type OnlineItem } from "@/lib/online/buy";
import { BookingClosed, MemberApp, MemberHeader, MemberSection, studioOr404 } from "../shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Buy", robots: { index: false, follow: false } };

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Memberships, packs and services the studio sells online. Works signed in
// (member app) or not (a new buyer enters their details at checkout), and on
// an iPad at the front desk.
export default async function BuyPage({ params }: { params: Promise<{ studio: string }> }) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const [member, items] = await Promise.all([getCurrentMember(studio), onlineItems(createSupabaseAdminClient(), studio.id)]);
  const groups = [
    { title: "Memberships", rows: items.filter((item) => item.kind === "membership") },
    { title: "Class packs & services", rows: items.filter((item) => item.kind !== "membership") },
  ].filter((group) => group.rows.length);

  const list = (
    <>
      {groups.length ? (
        groups.map((group) => (
          <MemberSection key={group.title} title={group.title}>
            <ul className="divide-y px-4">
              {group.rows.map((item: OnlineItem) => (
                <li key={item.id}>
                  <Link href={`/m/${studio.siteId}/buy/${item.id}`} className="flex items-center justify-between gap-3 py-4">
                    <span className="min-w-0">
                      <span className="block font-semibold">{item.name}</span>
                      <span className="text-sm text-neutral-600">
                        {money(item.priceCents)}
                        {item.monthly ? " / month" : item.sessions ? ` · ${item.sessions} ${item.sessions === 1 ? "visit" : "visits"}` : ""}
                        {item.membersOnly ? " · members only" : ""}
                      </span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-neutral-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </MemberSection>
        ))
      ) : (
        <MemberSection>
          <p className="px-4 py-6 text-sm text-neutral-600">
            Nothing is for sale online right now. Stop by the front desk and we&apos;ll help.
          </p>
        </MemberSection>
      )}
      <p className="px-4 py-4 text-xs text-neutral-500">Prices before tax. Payments are processed securely by Stripe.</p>
    </>
  );

  if (member)
    return (
      <MemberApp studio={studio} title="Buy" tab="more">
        {list}
      </MemberApp>
    );
  return (
    <div className="min-h-screen bg-neutral-100 font-sans text-neutral-900">
      <MemberHeader
        studio={studio}
        title={studio.name}
        action={
          <Link href={`/m/${studio.siteId}/sign-in`} className="underline-offset-4 hover:underline">
            Sign in
          </Link>
        }
      />
      <main className="mx-auto max-w-md pb-10">{list}</main>
    </div>
  );
}
