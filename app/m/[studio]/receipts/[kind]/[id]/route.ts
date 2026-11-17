import { NextRequest, NextResponse } from "next/server";
import { findStudio, getCurrentMember } from "@/lib/member/session";
import { memberReceiptPdf } from "@/lib/member/receipts";

export const runtime = "nodejs";

// GET /m/{studio}/receipts/{sale|dues}/{id}: the signed-in member's receipt
// as a PDF. Someone else's receipt (or a guessed id) is a plain 404.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ studio: string; kind: string; id: string }> }) {
  const { studio: studioParam, kind, id } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404 });
  if (!/^\d{1,9}$/.test(studioParam) || (kind !== "sale" && kind !== "dues") || !/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const studio = await findStudio(Number(studioParam));
  if (!studio || studio.mode === "off") return notFound();
  const member = await getCurrentMember(studio);
  if (!member) return NextResponse.redirect(new URL(`/m/${studio.siteId}/sign-in`, _request.url));
  const receipt = await memberReceiptPdf(
    {
      organizationId: studio.id,
      mindbodyClientId: member.mindbodyClientId,
      timezone: studio.timezone,
      studioName: studio.name,
      memberName: member.name,
    },
    kind,
    id,
  );
  if (!receipt) return notFound();
  return new NextResponse(Buffer.from(receipt.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${receipt.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
