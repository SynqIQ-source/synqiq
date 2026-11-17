import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseDollars } from "@/lib/maintenance/rules";
import { addEvent, canRunIssue, loadIssue, notifyStakeholders } from "@/lib/maintenance/server";

type RouteParams = { params: Promise<{ id: string }> };

// Updates on a report:
//   note, troubleshooting       any staff
//   visit (date + time), on_site, resolved, reopened
//                               the equipment's owner, a Facility Tech or a Club Admin
//   quote, paid (amounts)       Club Admins
export async function POST(request: NextRequest, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ success: false, error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const loaded = await loadIssue(admin, staff.organizationId, id);
  if (!loaded) return NextResponse.json({ success: false, error: "Report not found." }, { status: 404 });
  const { issue, equipment } = loaded;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 4000) : "";
  const base = { organization_id: issue.organization_id, issue_id: issue.id, staff_id: staff.id };
  const runs = canRunIssue(staff, equipment);
  const deny = (who: string) => NextResponse.json({ success: false, error: `Only ${who} can do this.` }, { status: 403 });

  if (kind === "note" || kind === "troubleshooting") {
    if (!text) return NextResponse.json({ success: false, error: "Write the note first." }, { status: 400 });
    await addEvent(admin, { ...base, kind, body: text });
    if (kind === "troubleshooting" && issue.status === "reported") {
      await admin.from("maintenance_issues").update({ status: "troubleshooting" }).eq("id", issue.id);
    }
    return NextResponse.json({ success: true });
  }

  if (kind === "quote" || kind === "paid") {
    if (staff.role !== "admin") return deny("a Club Admin");
    const cents = parseDollars(body?.amount);
    if (cents == null) return NextResponse.json({ success: false, error: "Enter the amount, e.g. 450 or 1,250.00." }, { status: 400 });
    await addEvent(admin, { ...base, kind, amount_cents: cents, body: text || null, vendor_id: issue.vendor_id });
    return NextResponse.json({ success: true });
  }

  if (!runs) return deny("the equipment's owner, a Facility Tech or a Club Admin");
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", issue.organization_id).single();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const ownerId = equipment?.owner_staff_id ?? null;

  if (kind === "visit") {
    const when = typeof body?.visitAt === "string" ? DateTime.fromISO(body.visitAt, { zone }) : null;
    if (!when?.isValid) return NextResponse.json({ success: false, error: "Pick the visit date and time." }, { status: 400 });
    const iso = when.toUTC().toISO()!;
    await admin.from("maintenance_issues").update({ status: "visit_scheduled", next_visit_at: iso }).eq("id", issue.id);
    await addEvent(admin, {
      ...base,
      kind: "visit",
      visit_at: iso,
      body: text || null,
      vendor_id: issue.vendor_id,
      status: "visit_scheduled",
    });
    await notifyStakeholders(admin, issue, ownerId, {
      subject: `Vendor visit scheduled: ${issue.title}`,
      lead: `${staff.displayName} scheduled the vendor visit for ${when.toFormat("cccc, LLL d 'at' h:mm a")}.`,
      body: text || null,
    });
    return NextResponse.json({ success: true });
  }
  if (kind === "on_site") {
    await admin.from("maintenance_issues").update({ status: "on_site" }).eq("id", issue.id);
    await addEvent(admin, { ...base, kind: "status", status: "on_site", body: text || "Vendor on site.", vendor_id: issue.vendor_id });
    return NextResponse.json({ success: true });
  }
  if (kind === "resolved") {
    const now = new Date().toISOString();
    await admin
      .from("maintenance_issues")
      .update({ status: "resolved", resolved_at: now, resolved_by_staff_id: staff.id, next_visit_at: null })
      .eq("id", issue.id);
    await addEvent(admin, { ...base, kind: "resolved", body: text || null, status: "resolved" });
    await notifyStakeholders(admin, issue, ownerId, {
      subject: `Resolved: ${issue.title}`,
      lead: `${staff.displayName} marked this maintenance issue resolved.`,
      body: text || null,
    });
    return NextResponse.json({ success: true });
  }
  if (kind === "reopened") {
    await admin
      .from("maintenance_issues")
      .update({ status: "troubleshooting", resolved_at: null, resolved_by_staff_id: null })
      .eq("id", issue.id);
    await addEvent(admin, { ...base, kind: "reopened", body: text || null, status: "troubleshooting" });
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ success: false, error: "Unknown update." }, { status: 400 });
}
