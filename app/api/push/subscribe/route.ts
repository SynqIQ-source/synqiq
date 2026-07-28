import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";

// A push subscription is tied to *this specific logged-in device* -- same
// reasoning as the admin-only routes requiring a real session, not the
// no-login dropdown fallback: there's no meaningful "subscribe on behalf of
// a staff member who isn't actually here."
export async function POST(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff) {
      return NextResponse.json({ success: false, error: "Sign in required." }, { status: 403 });
    }

    const body = await request.json();
    const endpoint: string | undefined = body?.endpoint;
    const p256dh: string | undefined = body?.keys?.p256dh;
    const auth: string | undefined = body?.keys?.auth;
    const userAgent = request.headers.get("user-agent");

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { success: false, error: "endpoint and keys.p256dh/keys.auth are required." },
        { status: 400 },
      );
    }

    const supabase = await getScopedClient(currentStaff);

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        organization_id: currentStaff.organizationId,
        staff_id: currentStaff.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
      },
      { onConflict: "endpoint" },
    );

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff) {
      return NextResponse.json({ success: false, error: "Sign in required." }, { status: 403 });
    }

    const body = await request.json();
    const endpoint: string | undefined = body?.endpoint;

    if (!endpoint) {
      return NextResponse.json({ success: false, error: "endpoint is required." }, { status: 400 });
    }

    const supabase = await getScopedClient(currentStaff);

    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
