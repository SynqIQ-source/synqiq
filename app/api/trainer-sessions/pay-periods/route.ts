import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTrainerPilot } from "@/lib/trainer/pilot";
import { loadPeriod, periodCsv } from "@/lib/trainer/pay-periods";
import { PAY_PERIOD_ANCHOR, periodContaining } from "@/lib/trainer/pilot-rules";

// Trainer session pay periods (pilot), Club Admins only.
//   GET  ?start=yyyy-mm-dd                       CSV of the period's pay lines
//   POST { action: approve|unapprove|lock, start }
// A locked period can't change (database trigger); corrections after that go
// into the next open period.
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function guard() {
  const me = await getCurrentStaff();
  if (!me || !isClubAdmin(me)) return { error: NextResponse.json({ success: false, error: "Club Admins only." }, { status: 403 }) };
  const pilot = await getTrainerPilot(me.organizationId);
  if (!pilot.on) return { error: NextResponse.json({ success: false, error: "The trainer sessions pilot is off." }, { status: 403 }) };
  return { me };
}

export async function GET(request: NextRequest) {
  const { me, error } = await guard();
  if (error) return error;
  const start = request.nextUrl.searchParams.get("start") ?? "";
  if (!DATE.test(start)) return NextResponse.json({ success: false, error: "Pick a period." }, { status: 400 });
  const data = await loadPeriod(createSupabaseAdminClient(), me.organizationId, start);
  return new NextResponse(periodCsv(data.lines), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trainer-session-pay-${data.period.startsOn}-to-${data.period.endsOn}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const { me, error } = await guard();
  if (error) return error;
  const body = (await request.json().catch(() => null)) as { action?: string; start?: string } | null;
  const start = typeof body?.start === "string" && DATE.test(body.start) ? body.start : null;
  if (!start || !["approve", "unapprove", "lock"].includes(body?.action ?? ""))
    return NextResponse.json({ success: false, error: "Pick a period and an action." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const period = periodContaining(start, PAY_PERIOD_ANCHOR);
  await admin
    .from("pay_periods")
    .upsert(
      { organization_id: me.organizationId, starts_on: period.startsOn, ends_on: period.endsOn },
      { onConflict: "organization_id,starts_on", ignoreDuplicates: true },
    );
  const now = new Date().toISOString();
  const from = body!.action === "approve" ? "open" : "approved";
  const patch =
    body!.action === "approve"
      ? { status: "approved", approved_at: now, approved_by_staff_id: me.id }
      : body!.action === "unapprove"
        ? { status: "open", approved_at: null, approved_by_staff_id: null }
        : { status: "locked", locked_at: now, locked_by_staff_id: me.id };
  const { data, error: saveError } = await admin
    .from("pay_periods")
    .update(patch)
    .eq("organization_id", me.organizationId)
    .eq("starts_on", period.startsOn)
    .eq("status", from)
    .select("id");
  if (saveError) return NextResponse.json({ success: false, error: saveError.message }, { status: 400 });
  if (!data?.length)
    return NextResponse.json(
      { success: false, error: body!.action === "lock" ? "Approve the period before locking it." : "The period changed. Refresh." },
      { status: 409 },
    );
  return NextResponse.json({ success: true });
}
