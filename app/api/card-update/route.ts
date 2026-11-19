import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { finishCardUpdate, startCardUpdate } from "@/lib/billing/cards";
import { findCardLink } from "@/lib/billing/card-links";

// The emailed "update your card" link (/card/<token>): no sign-in; the token
// (7 days, once) says which member and studio. The card goes to Stripe.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const link = await findCardLink(String(body?.token ?? ""));
  if (!link)
    return NextResponse.json({ success: false, error: "This link has expired. Ask the front desk for a new one." }, { status: 404 });

  if (body?.action === "start") {
    const result = await startCardUpdate(link.organizationId, link.clientId, "link", null);
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, ...result });
  }
  if (body?.action === "finish") {
    const result = await finishCardUpdate(String(body.setupIntentId ?? ""), {
      organizationId: link.organizationId,
      clientId: link.clientId,
    });
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    await createSupabaseAdminClient().from("card_update_links").update({ used_at: new Date().toISOString() }).eq("id", link.id);
    return NextResponse.json({ success: true, ...result });
  }
  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}
