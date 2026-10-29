import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { KPI_METRICS } from "@/lib/crm/kpis";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;

// Saves one month's targets for the club (staffId null) or one salesperson.
// The submitted set replaces that month's targets for that scope; a blank
// metric has no target. Admin only.
export async function PUT(request: NextRequest) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const body = await readJsonBody(request);
    const month = typeof body?.month === "string" && MONTH_PATTERN.test(body.month) ? body.month : null;
    if (!month) return jsonError("Pick a month.", 400);
    const staffId = body?.staffId ?? null;
    if (staffId !== null && !isUuid(staffId)) return jsonError("Pick a salesperson.", 400);
    const submitted = body?.targets;
    if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
      return jsonError("Nothing to save.", 400);
    }

    const rows: { metric: string; target: number }[] = [];
    for (const [metric, raw] of Object.entries(submitted as Record<string, unknown>)) {
      const definition = KPI_METRICS.get(metric);
      if (!definition) return jsonError("Unknown target.", 400);
      if (raw === null || raw === "") continue;
      const value = typeof raw === "number" ? raw : Number(raw);
      const max = definition.kind === "percent" ? 100 : 1_000_000;
      if (!Number.isFinite(value) || value < 0 || value > max) {
        return jsonError(`${definition.label} must be a number from 0 to ${max.toLocaleString()}.`, 400);
      }
      rows.push({ metric, target: Math.round(value * 100) / 100 });
    }

    const admin = createSupabaseAdminClient();
    if (staffId) {
      const { data: person } = await admin
        .from("staff")
        .select("id")
        .eq("id", staffId)
        .eq("organization_id", staff.organizationId)
        .is("archived_at", null)
        .maybeSingle();
      if (!person) return jsonError("Salesperson not found.", 404);
    }

    let clear = admin.from("crm_kpi_targets").delete().eq("organization_id", staff.organizationId).eq("month", month);
    clear = staffId ? clear.eq("staff_id", staffId) : clear.is("staff_id", null);
    const { error: clearError } = await clear;
    if (clearError) throw clearError;

    if (rows.length > 0) {
      const now = new Date().toISOString();
      const { error } = await admin.from("crm_kpi_targets").insert(
        rows.map((row) => ({
          organization_id: staff.organizationId,
          month,
          staff_id: staffId,
          metric: row.metric,
          target: row.target,
          updated_by_staff_id: staff.id,
          updated_at: now,
        })),
      );
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/kpi-targets PUT", error);
    return jsonError("Couldn't save the targets.", 500);
  }
}
