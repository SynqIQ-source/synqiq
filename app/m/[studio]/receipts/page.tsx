import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { getCurrentMember } from "@/lib/member/session";
import { listReceipts } from "@/lib/member/receipts";
import { BookingClosed, MemberShell, studioOr404 } from "../shell";
import { SignOutButton } from "../member-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipts", robots: { index: false, follow: false } };

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A member's receipts: purchases (in club or in the app) and monthly dues,
// each downloadable as a PDF.
export default async function ReceiptsPage({ params }: { params: Promise<{ studio: string }> }) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const member = await getCurrentMember(studio);
  if (!member) redirect(`/m/${studio.siteId}/sign-in`);
  const receipts = await listReceipts({ organizationId: studio.id, mindbodyClientId: member.mindbodyClientId, timezone: studio.timezone });

  return (
    <MemberShell studio={studio} title="Receipts">
      <div className="mb-4 flex justify-between text-sm">
        <span className="flex gap-3">
          <Link href={`/m/${studio.siteId}`} className="underline underline-offset-4">
            Book a class
          </Link>
          <Link href={`/m/${studio.siteId}/my-classes`} className="underline underline-offset-4">
            My classes
          </Link>
        </span>
        <SignOutButton />
      </div>
      {receipts.length ? (
        <ul className="divide-y rounded-lg border">
          {receipts.map((receipt) => (
            <li key={`${receipt.kind}-${receipt.id}`}>
              <a
                href={`/m/${studio.siteId}/receipts/${receipt.kind}/${receipt.id}`}
                className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-neutral-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{receipt.description}</span>
                  <span className="text-sm text-neutral-600">
                    {DateTime.fromISO(receipt.date).toFormat("LLL d, yyyy")}
                    {receipt.practice ? " · practice" : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  <span className="block font-medium tabular-nums">{money(receipt.totalCents)}</span>
                  <span className="text-xs text-neutral-500 underline underline-offset-2">PDF</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-600">No receipts yet. Purchases and monthly dues paid through {studio.name} will show here.</p>
      )}
      <p className="mt-6 text-xs text-neutral-500">Purchases made before {studio.name} moved to this app aren&apos;t listed here.</p>
    </MemberShell>
  );
}
