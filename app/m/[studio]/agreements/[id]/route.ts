import { NextRequest, NextResponse } from "next/server";
import { findStudio, getCurrentMember } from "@/lib/member/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { signedAgreementPdf } from "@/lib/agreements/sale";

export const runtime = "nodejs";

// GET /m/{studio}/agreements/{id}: the signed-in member's own signed
// agreement as a PDF. Anyone else's (or a guessed id) is a plain 404.
export async function GET(request: NextRequest, { params }: { params: Promise<{ studio: string; id: string }> }) {
  const { studio: studioParam, id } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404 });
  if (!/^\d{1,9}$/.test(studioParam) || !/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const studio = await findStudio(Number(studioParam));
  if (!studio || studio.mode === "off") return notFound();
  const member = await getCurrentMember(studio);
  if (!member) return NextResponse.redirect(new URL(`/m/${studio.siteId}/sign-in`, request.url));
  const file = await signedAgreementPdf(createSupabaseAdminClient(), studio.id, id, member.mindbodyClientId);
  if (!file) return notFound();
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
