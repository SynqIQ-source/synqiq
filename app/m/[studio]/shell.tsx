import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findStudio, type Studio } from "@/lib/member/session";

// Shared pieces for the member booking pages.

export async function studioOr404(param: string): Promise<Studio> {
  const studio = /^\d{1,9}$/.test(param) ? await findStudio(Number(param)) : null;
  if (!studio) notFound();
  return studio;
}

export function MemberShell({ studio, title, children }: { studio: Studio; title?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-8 font-sans text-neutral-900">
      <div className="mx-auto max-w-md rounded-xl border bg-white p-6 shadow-sm">
        <Link href={`/m/${studio.siteId}`} className="mb-4 flex items-center gap-3">
          {studio.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- studio logo
            <img src={studio.logoUrl} alt="" className="h-8 w-auto" />
          ) : null}
          <span className="text-base font-semibold">{studio.name}</span>
        </Link>
        {title ? <h1 className="mb-4 text-xl font-semibold">{title}</h1> : null}
        {children}
      </div>
    </div>
  );
}

export function BookingClosed({ studio }: { studio: Studio }) {
  return (
    <MemberShell studio={studio} title="Online booking">
      <p className="text-sm text-neutral-600">Online booking isn&apos;t available yet. Please book with the front desk.</p>
    </MemberShell>
  );
}

export const UUID = /^[0-9a-f-]{36}$/i;
