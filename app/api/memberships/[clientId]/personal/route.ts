import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { mergePersonal, validatePersonalEdit, type MemberPersonal, type PersonalField } from "@/lib/memberships/personal";

type RouteParams = { params: Promise<{ clientId: string }> };

// Club Admins edit a member's personal information. Saved in SynqIQ
// (member_personal.edits, which win over Mindbody's copy and survive syncs)
// with a change log; SynqIQ doesn't write to Mindbody.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { clientId: raw } = await params;
  const clientId = decodeURIComponent(raw);
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !isClubAdmin(currentStaff)) {
    return NextResponse.json({ success: false, error: "Only a club admin can do this." }, { status: 403 });
  }
  if (!/^[\w-]{1,40}$/.test(clientId)) return NextResponse.json({ success: false, error: "Unknown member." }, { status: 404 });
  const body = await request.json().catch(() => null);

  const supabase = await getScopedClient(currentStaff);
  const orgId = currentStaff.organizationId;
  const [{ data: client }, { data: row }, { data: org }] = await Promise.all([
    supabase
      .from("clients")
      .select("first_name, last_name, email")
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .maybeSingle(),
    supabase
      .from("member_personal")
      .select("mindbody, edits")
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .maybeSingle(),
    supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle(),
  ]);
  if (!client) return NextResponse.json({ success: false, error: "Unknown member." }, { status: 404 });

  const mindbody = {
    firstName: client.first_name as string,
    lastName: client.last_name as string,
    email: (client.email as string | null) ?? null,
    ...((row?.mindbody as Partial<MemberPersonal> | undefined) ?? {}),
  };
  const edits = (row?.edits as Partial<Record<PersonalField, string | null>> | undefined) ?? {};
  const current = mergePersonal(mindbody, edits);
  const today = DateTime.now()
    .setZone((org?.timezone as string | undefined) ?? "America/Chicago")
    .toISODate()!;
  const result = validatePersonalEdit(body, current, today);
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  const changed = Object.keys(result.changes) as PersonalField[];
  if (!changed.length) return NextResponse.json({ success: true, changed: 0 });

  const nextEdits = { ...edits };
  for (const field of changed) nextEdits[field] = result.changes[field]!.to;
  const now = new Date().toISOString();
  const { error } = await supabase.from("member_personal").upsert(
    {
      organization_id: orgId,
      mindbody_client_id: clientId,
      edits: nextEdits,
      edited_at: now,
      edited_by_staff_id: currentStaff.id,
    },
    { onConflict: "organization_id,mindbody_client_id" },
  );
  if (error) {
    console.error("[member-personal] save failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  const { error: logError } = await supabase.from("member_personal_edits").insert({
    organization_id: orgId,
    mindbody_client_id: clientId,
    changes: result.changes,
    edited_by_staff_id: currentStaff.id,
  });
  if (logError) console.error("[member-personal] change log failed:", logError.message);
  return NextResponse.json({ success: true, changed: changed.length });
}
