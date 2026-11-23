import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTrainerPilot } from "@/lib/trainer/pilot";
import { rateInputProblem } from "@/lib/trainer/pilot-rules";

// Club Admins: add an effective-dated trainer session rate (pilot). Rates are
// never edited or deleted -- a change is a new row from its date -- so pay
// lines already recorded keep the rate they were written with.
//   POST { staffId, sessionTypeId|null, method: percent|flat, percent?, flatDollars?, effectiveFrom, note? }
export async function POST(request: NextRequest) {
  const me = await getCurrentStaff();
  if (!me || !isClubAdmin(me)) return NextResponse.json({ success: false, error: "Club Admins only." }, { status: 403 });
  const pilot = await getTrainerPilot(me.organizationId);
  if (!pilot.on) return NextResponse.json({ success: false, error: "The trainer sessions pilot is off." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ success: false, error: "Nothing to save." }, { status: 400 });
  const parsed = rateInputProblem({
    method: String(body.method ?? ""),
    percent: typeof body.percent === "string" ? body.percent : String(body.percent ?? ""),
    flatDollars: typeof body.flatDollars === "string" ? body.flatDollars : String(body.flatDollars ?? ""),
    effectiveFrom: String(body.effectiveFrom ?? ""),
  });
  if ("error" in parsed) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const staffId = typeof body.staffId === "string" ? body.staffId : "";
  const typeId = body.sessionTypeId == null || body.sessionTypeId === "" ? null : Number(body.sessionTypeId);
  if (typeId != null && !Number.isInteger(typeId)) return NextResponse.json({ success: false, error: "Pick a session type." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: trainer } = await admin.from("staff").select("id").eq("id", staffId).eq("organization_id", me.organizationId).maybeSingle();
  if (!trainer) return NextResponse.json({ success: false, error: "Pick a trainer." }, { status: 400 });
  const { error } = await admin.from("trainer_session_rates").insert({
    organization_id: me.organizationId,
    staff_id: staffId,
    session_type_id: typeId,
    method: parsed.method,
    percent_bp: parsed.percentBp,
    flat_cents: parsed.flatCents,
    effective_from: parsed.effectiveFrom,
    note: typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null,
    created_by_staff_id: me.id,
  });
  if (error?.code === "23505")
    return NextResponse.json({ success: false, error: "That trainer already has a rate for this session type starting that day." }, { status: 409 });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
