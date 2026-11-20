import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentMember } from "@/lib/member/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { onlineItems } from "@/lib/online/buy";
import { BookingClosed, MemberHeader, UUID, studioOr404 } from "../../shell";
import { BuyFlow } from "./buy-flow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

export default async function BuyItemPage({ params }: { params: Promise<{ studio: string; itemId: string }> }) {
  const { studio: studioParam, itemId } = await params;
  const studio = await studioOr404(studioParam);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  if (!UUID.test(itemId)) notFound();
  const [member, items] = await Promise.all([getCurrentMember(studio), onlineItems(createSupabaseAdminClient(), studio.id)]);
  const item = items.find((row) => row.id === itemId);
  if (!item) notFound();

  return (
    <div className="min-h-screen bg-neutral-100 font-sans text-neutral-900">
      <MemberHeader
        studio={studio}
        title="Checkout"
        action={
          <Link href={`/m/${studio.siteId}/buy`} className="underline-offset-4 hover:underline">
            Back
          </Link>
        }
      />
      <main className="mx-auto max-w-md px-4 py-4 pb-16">
        <BuyFlow
          studio={studio.siteId}
          color={studio.primaryColor}
          item={item}
          memberName={member?.name ?? null}
          signInHref={`/m/${studio.siteId}/sign-in`}
          doneHref={member ? `/m/${studio.siteId}/wallet` : `/m/${studio.siteId}`}
        />
      </main>
    </div>
  );
}
