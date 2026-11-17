import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

// Agreements (Club Admins).
// POST { action: "save", id?, name, body }: add an agreement, or change one
//   (its version goes up; agreements already signed keep the text they signed).
// POST { action: "archive", id }: stop using an agreement (items lose it).
// POST { action: "legalName", legalName }: the business name on agreements.
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return fail("Only a Club Admin can change agreements.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Nothing to save.");
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const now = new Date().toISOString();

  if (body.action === "save") {
    const name = String(body.name ?? "").trim();
    const text = String(body.body ?? "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (!name || name.length > 120) return fail("Give the agreement a name (up to 120 characters).");
    if (!text) return fail("Add the agreement's text.");
    if (text.length > 100_000) return fail("That agreement is too long (100,000 characters at most).");
    if (isUuid(body.id)) {
      const { data: current } = await admin
        .from("agreement_templates")
        .select("version, body, name")
        .eq("id", body.id)
        .eq("organization_id", org)
        .maybeSingle();
      if (!current) return fail("That agreement wasn't found.", 404);
      const changed = current.body !== text;
      const { error } = await admin
        .from("agreement_templates")
        .update({
          name,
          body: text,
          version: changed ? Number(current.version) + 1 : Number(current.version),
          updated_at: now,
          updated_by_staff_id: staff.id,
        })
        .eq("id", body.id)
        .eq("organization_id", org);
      return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true, id: body.id });
    }
    const { data, error } = await admin
      .from("agreement_templates")
      .insert({ organization_id: org, name, body: text, updated_by_staff_id: staff.id })
      .select("id")
      .single();
    return error || !data ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true, id: data.id });
  }

  if (body.action === "archive") {
    if (!isUuid(body.id)) return fail("Pick an agreement.");
    await admin.from("pos_items").update({ agreement_template_id: null }).eq("organization_id", org).eq("agreement_template_id", body.id);
    const { error } = await admin
      .from("agreement_templates")
      .update({ active: false, updated_at: now, updated_by_staff_id: staff.id })
      .eq("id", body.id)
      .eq("organization_id", org);
    return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true });
  }

  if (body.action === "legalName") {
    const legalName = String(body.legalName ?? "").trim();
    if (!legalName || legalName.length > 200) return fail("Enter the business's legal name.");
    const { error } = await admin.from("organizations").update({ legal_name: legalName }).eq("id", org);
    return error ? fail("Couldn't save. Try again.", 500) : NextResponse.json({ success: true });
  }

  return fail("Unknown action.");
}
