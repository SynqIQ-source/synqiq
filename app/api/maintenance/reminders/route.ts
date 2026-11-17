import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyStakeholders, type IssueRow } from "@/lib/maintenance/server";

// Daily (cron, ~7 AM Central), each reminder once:
//   - a vendor visit tomorrow -> the owner + Club Admins
//   - a critical issue's vendor hasn't replied in 24 hours -> them too
//   - a visit date passed a day ago and the issue is still open -> them too
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const now = DateTime.now();
  const results = { tomorrow: 0, noReply: 0, visitPassed: 0 };

  const owners = async (issue: IssueRow) => {
    if (!issue.equipment_id) return null;
    const { data } = await admin.from("maintenance_equipment").select("owner_staff_id").eq("id", issue.equipment_id).maybeSingle();
    return (data?.owner_staff_id as string | null) ?? null;
  };

  const { data: orgs } = await admin.from("organizations").select("id, timezone");
  const zones = new Map((orgs ?? []).map((org) => [org.id as string, (org.timezone as string | null) ?? "America/Chicago"]));

  // Visits tomorrow (studio's own calendar day).
  const { data: upcoming } = await admin
    .from("maintenance_issues")
    .select("*")
    .eq("status", "visit_scheduled")
    .gte("next_visit_at", now.toUTC().toISO()!)
    .lte("next_visit_at", now.plus({ days: 2 }).toUTC().toISO()!);
  for (const issue of (upcoming ?? []) as IssueRow[]) {
    const zone = zones.get(issue.organization_id) ?? "America/Chicago";
    const visit = DateTime.fromISO(issue.next_visit_at!).setZone(zone);
    if (visit.toISODate() !== now.setZone(zone).plus({ days: 1 }).toISODate()) continue;
    await notifyStakeholders(admin, issue, await owners(issue), {
      subject: `Vendor visit tomorrow: ${issue.title}`,
      lead: `The vendor is due tomorrow, ${visit.toFormat("cccc, LLL d 'at' h:mm a")}. Make sure someone can let them in.`,
    });
    results.tomorrow += 1;
  }

  // Critical, vendor emailed 24-48 hours ago, no reply yet.
  const { data: waiting } = await admin
    .from("maintenance_issues")
    .select("*")
    .eq("is_critical", true)
    .eq("status", "vendor_contacted")
    .is("last_vendor_reply_at", null)
    .lte("vendor_contacted_at", now.minus({ hours: 24 }).toUTC().toISO()!)
    .gt("vendor_contacted_at", now.minus({ hours: 48 }).toUTC().toISO()!);
  for (const issue of (waiting ?? []) as IssueRow[]) {
    await notifyStakeholders(admin, issue, await owners(issue), {
      subject: `No vendor reply in 24 hours: ${issue.title}`,
      lead: "The vendor hasn't replied to this critical issue. Follow up from the report or try another vendor.",
    });
    results.noReply += 1;
  }

  // Visit was 24-48 hours ago and the issue is still open.
  const { data: passed } = await admin
    .from("maintenance_issues")
    .select("*")
    .in("status", ["visit_scheduled", "on_site"])
    .lte("next_visit_at", now.minus({ hours: 24 }).toUTC().toISO()!)
    .gt("next_visit_at", now.minus({ hours: 48 }).toUTC().toISO()!);
  for (const issue of (passed ?? []) as IssueRow[]) {
    await notifyStakeholders(admin, issue, await owners(issue), {
      subject: `Still open after the vendor visit: ${issue.title}`,
      lead: "The vendor visit date has passed. Mark it resolved, schedule a follow-up visit, or add a note.",
    });
    results.visitPassed += 1;
  }
  return NextResponse.json({ success: true, ...results });
}
