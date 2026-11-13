import type { Metadata } from "next";
import { BookingClosed, MemberShell, UUID, studioOr404 } from "../shell";
import { RequestLinkForm } from "../member-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set your password", robots: { index: false, follow: false } };

type Props = { params: Promise<{ studio: string }>; searchParams: Promise<{ new?: string; class?: string }> };

// First time (create a password) and forgot password: both email a link.
export default async function MemberGetLinkPage({ params, searchParams }: Props) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const query = await searchParams;
  const isNew = query.new === "1";
  const classId = query.class && UUID.test(query.class) ? query.class : undefined;
  return (
    <MemberShell studio={studio} title={isNew ? "Create your password" : "Reset your password"}>
      <p className="mb-4 text-sm text-neutral-600">
        {isNew
          ? "Members already have an account with the studio. Enter your email and we'll send a link to choose a password."
          : "Enter your email and we'll send a link to choose a new password."}
      </p>
      <RequestLinkForm studio={studio.siteId} color={studio.primaryColor} classId={classId} />
    </MemberShell>
  );
}
