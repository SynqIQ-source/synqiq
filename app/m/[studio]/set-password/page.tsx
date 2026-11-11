import type { Metadata } from "next";
import Link from "next/link";
import { BookingClosed, MemberShell, studioOr404 } from "../shell";
import { SetPasswordForm } from "../member-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose a password", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ studio: string }>; searchParams: Promise<{ token?: string }> };

// From the emailed link. The token is checked when the form is sent.
export default async function MemberSetPasswordPage({ params, searchParams }: Props) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const { token } = await searchParams;
  return (
    <MemberShell studio={studio} title="Choose a password">
      {token && token.length <= 200 ? (
        <SetPasswordForm studio={studio.siteId} color={studio.primaryColor} token={token} />
      ) : (
        <p className="text-sm text-neutral-600">
          This link isn&apos;t complete.{" "}
          <Link href={`/m/${studio.siteId}/get-link`} className="underline underline-offset-4">
            Ask for a new one
          </Link>
          .
        </p>
      )}
    </MemberShell>
  );
}
