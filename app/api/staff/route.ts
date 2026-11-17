import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { cleanText, normalizeEmail, normalizePhone } from "@/lib/crm/normalize";
import { sendStaffInvite } from "@/lib/staff/invite";
import { getOptionalEnv } from "@/lib/env";
import { resolveRequestOrigin } from "@/lib/request-origin";

// Club Admins add an employee in SynqIQ (not from Mindbody): name, email,
// mobile, role, Trainer / Sells tags. They're emailed a link to set their
// password right away. Instructors who teach classes are added at the
// Mindbody cutover (classes still identify instructors by Mindbody id).
// If the same person is later added in Mindbody, the staff sync links them
// by email instead of creating a second person.
export async function POST(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || currentStaff.role !== "admin") {
    return NextResponse.json({ success: false, error: "Only a Club Admin can add employees." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const firstName = cleanText(body?.firstName, 60);
  const lastName = cleanText(body?.lastName, 60);
  const email = normalizeEmail(body?.email);
  const phone = normalizePhone(body?.phone);
  const role = STAFF_ROLES.includes(body?.role as StaffRole) ? (body?.role as StaffRole) : null;
  if (!firstName || !lastName) return NextResponse.json({ success: false, error: "Add their first and last name." }, { status: 400 });
  if (!email) return NextResponse.json({ success: false, error: "Add a valid email (their login invite goes there)." }, { status: 400 });
  if (!phone) return NextResponse.json({ success: false, error: "Add a valid mobile number." }, { status: 400 });
  if (!role) return NextResponse.json({ success: false, error: "Pick a role." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const orgId = currentStaff.organizationId;
  const { data: existing } = await admin
    .from("staff")
    .select("id, display_name")
    .eq("organization_id", orgId)
    .ilike(
      "email",
      email.replace(/[\\%_]/g, (c) => `\\${c}`),
    )
    .limit(1);
  if (existing?.length) {
    return NextResponse.json(
      { success: false, error: `${existing[0].display_name} already uses ${email}. Find them in the list instead.` },
      { status: 409 },
    );
  }

  const { data: created, error } = await admin
    .from("staff")
    .insert({
      organization_id: orgId,
      first_name: firstName,
      last_name: lastName,
      display_name: `${firstName} ${lastName}`,
      email,
      phone,
      active: true,
      role,
      can_sell: body?.canSell === true,
      is_trainer: body?.isTrainer === true,
      is_instructor: false,
      teaching_roles_set_at: new Date().toISOString(),
      hire_date: typeof body?.hireDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.hireDate) ? body.hireDate : null,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[staff/create]", error?.message);
    return NextResponse.json({ success: false, error: "Couldn't add them. Try again." }, { status: 500 });
  }

  const origin = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? resolveRequestOrigin(request);
  const invite = await sendStaffInvite(admin, { staffId: created.id as string, email, origin });
  return NextResponse.json({
    success: true,
    id: created.id,
    invited: invite.ok,
    inviteError: invite.ok ? null : invite.error,
  });
}
