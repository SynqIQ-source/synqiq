import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { getOptionalEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { refreshStudioAccount } from "@/lib/payments/connect";

// Stripe Connect event destination (thin v2 events) for studios' connected
// accounts. Every request's signature is checked against the raw body; each
// event is applied once (stripe_connect_events) and never trusted for state:
// on any account event we re-read the account from Stripe. Events can arrive
// twice or out of order -- re-reading makes that harmless.
export async function POST(request: NextRequest) {
  const secret = getOptionalEnv("STRIPE_CONNECT_WEBHOOK_SECRET");
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  let notification: { id: string; type: string; related_object?: { id?: string } | null };
  try {
    notification = getStripe().parseEventNotification(raw, signature, secret) as unknown as typeof notification;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const accountId = notification.type.startsWith("v2.core.account") ? (notification.related_object?.id ?? null) : null;
  const { error: seenError } = await admin
    .from("stripe_connect_events")
    .insert({ id: notification.id, type: notification.type, stripe_account_id: accountId });
  if (seenError) {
    // Already handled (duplicate delivery): acknowledge.
    if (seenError.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }
  if (accountId) {
    const { data: row } = await admin
      .from("stripe_connected_accounts")
      .select("organization_id")
      .eq("stripe_account_id", accountId)
      .maybeSingle();
    if (row) {
      try {
        await refreshStudioAccount(admin, row.organization_id as string);
      } catch (error) {
        console.error("[stripe/connect-events] refresh failed:", error);
        // Let Stripe retry; forget this event so the retry is processed.
        await admin.from("stripe_connect_events").delete().eq("id", notification.id);
        return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
      }
    }
  }
  return NextResponse.json({ received: true });
}
