import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";

type RouteParams = { params: Promise<{ id: string }> };

// Club Admins cancel a scheduled price increase before it starts. It stays
// in the list, marked with who cancelled it, when and why.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return NextResponse.json({ success: false, error: "Only a club admin can do this." }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    reason?: unknown;
  } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ success: false, error: "Add a reason." }, { status: 400 });
  if (reason.length > 500) return NextResponse.json({ success: false, error: "Keep the reason under 500 characters." }, { status: 400 });

  const supabase = await getScopedClient(currentStaff);
  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", currentStaff.organizationId).maybeSingle();
  const today = DateTime.now()
    .setZone((org?.timezone as string | undefined) ?? "America/Chicago")
    .toISODate()!;

  const { data, error } = await supabase
    .from("price_increases")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_by_staff_id: currentStaff.id,
      cancel_reason: reason,
    })
    .eq("id", id)
    .eq("organization_id", currentStaff.organizationId)
    .is("cancelled_at", null)
    .gt("effective_on", today)
    .select("id");
  if (error) {
    console.error("[price-increases] cancel failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't cancel. Try again." }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json(
      {
        success: false,
        error: "Already cancelled, already started, or not found.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true });
}
