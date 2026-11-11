import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/member/session";
import { BookingClosed, MemberShell, UUID, studioOr404 } from "../shell";
import { SignInForm } from "../member-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

type Props = { params: Promise<{ studio: string }>; searchParams: Promise<{ class?: string }> };

export default async function MemberSignInPage({ params, searchParams }: Props) {
  const studio = await studioOr404((await params).studio);
  if (studio.mode === "off") return <BookingClosed studio={studio} />;
  const { class: classId } = await searchParams;
  const next = `/m/${studio.siteId}${classId && UUID.test(classId) ? `?class=${classId}` : ""}`;
  if (await getCurrentMember(studio)) redirect(next);
  return (
    <MemberShell studio={studio} title="Sign in to book">
      <SignInForm studio={studio.siteId} color={studio.primaryColor} next={next} />
    </MemberShell>
  );
}
