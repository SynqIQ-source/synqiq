import type { Metadata } from "next";
import { DateTime } from "luxon";
import { findRatingRequest } from "@/lib/ratings/token";
import { RatingForm, StopForm } from "./rating-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rate your class", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ stars?: string; stop?: string }> };

// From the rating email. Tapping a star in the email opens this page with
// that star chosen; nothing is saved until the member taps Submit (email
// scanners open links, so a click alone must not count as a rating).
export default async function RatePage({ params, searchParams }: Props) {
  const { token } = await params;
  const query = await searchParams;
  const found = await findRatingRequest(decodeURIComponent(token));
  const shell = (body: React.ReactNode, studio?: { name: string; logoUrl: string | null }) => (
    <div className="min-h-screen bg-neutral-50 px-4 py-8 font-sans text-neutral-900">
      <div className="mx-auto max-w-md rounded-xl border bg-white p-6 shadow-sm">
        {studio ? (
          <div className="mb-4 flex items-center gap-3">
            {studio.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- studio logo
              <img src={studio.logoUrl} alt="" className="h-8 w-auto" />
            ) : null}
            <span className="text-base font-semibold">{studio.name}</span>
          </div>
        ) : null}
        {body}
      </div>
    </div>
  );
  if (!found) return shell(<p className="text-sm text-neutral-600">This link isn&apos;t valid. It may have been used already.</p>);
  const { request, studio, instructor, open } = found;
  if (query.stop === "1") return shell(<StopForm token={token} color={studio.color} />, studio);
  if (request.status === "rated") return shell(<p className="text-base">Thanks, we already have your rating for this class.</p>, studio);
  if (!open) return shell(<p className="text-sm text-neutral-600">This link has expired. Thanks anyway!</p>, studio);
  const when = DateTime.fromISO(request.class_start as string)
    .setZone(studio.timezone)
    .toFormat("cccc, LLL d");
  const stars = Number(query.stars);
  return shell(
    <>
      <h1 className="mb-1 text-xl font-semibold">
        How was {request.class_name as string} with {instructor}?
      </h1>
      <p className="mb-4 text-sm text-neutral-600">{when}</p>
      <RatingForm token={token} color={studio.color} initialStars={Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : 0} />
    </>,
    studio,
  );
}
