import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { runTakeover } from "@/lib/classes/takeover";

export const maxDuration = 300;

// Club Admins: take over the class schedule from Mindbody (see
// lib/classes/takeover.ts). Needs the typed confirmation from the page.
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return NextResponse.json({ success: false, error: "Club Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "TAKE OVER") return NextResponse.json({ success: false, error: 'Type "TAKE OVER" to confirm.' }, { status: 400 });
  const result = await runTakeover(staff.organizationId, staff.id);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
