import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dollarsToCents, fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";
import { COMMISSION_CATEGORIES, commissionRuleProblem } from "@/lib/payroll/commission";
import { computeCommissions } from "@/lib/payroll/commission-job";
import { STAFF_ROLES } from "@/lib/permissions";

// Commission settings and actions (Club Admin). One endpoint, by `action`:
//   category   { productId, category }
//   plan       { id?, name, defaultRoles[], defaultTrainers, defaultEnabled }
//   archivePlan{ id }
//   rule       { planId, category, condition, percent, flat }
//   removeRule { id }
//   person     { staffId, planId (uuid | ""), enabled ("default" | "on" | "off") }
//   handoff    { detailId, approved }
//   recalc     { from, to }  (YYYY-MM-DD, studio dates)
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { currentStaff } = auth;
  const org = currentStaff.organizationId;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Nothing to save.");
  const admin = createSupabaseAdminClient();
  const ok = () => NextResponse.json({ success: true });
  const now = new Date().toISOString();

  switch (body.action) {
    case "category": {
      const productId = Number(body.productId);
      const category = String(body.category ?? "");
      if (!Number.isInteger(productId) || !COMMISSION_CATEGORIES.includes(category as never)) return fail("Pick a category.");
      const { error } = await admin
        .from("commission_items")
        .update({ category, updated_at: now, updated_by_staff_id: currentStaff.id })
        .eq("organization_id", org)
        .eq("product_id", productId);
      return error ? fail("Couldn't save. Try again.", 500) : ok();
    }
    case "plan": {
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 120) return fail("Give the plan a name.");
      const roles = Array.isArray(body.defaultRoles) ? body.defaultRoles.filter((role) => STAFF_ROLES.includes(role as never)) : [];
      const row = {
        organization_id: org,
        name,
        default_roles: roles,
        default_trainers: body.defaultTrainers === true,
        default_enabled: body.defaultEnabled !== false,
        updated_at: now,
      };
      const { error } = isUuid(body.id)
        ? await admin.from("commission_plans").update(row).eq("id", body.id).eq("organization_id", org)
        : await admin.from("commission_plans").insert(row);
      return error ? fail("Couldn't save. Try again.", 500) : ok();
    }
    case "archivePlan": {
      if (!isUuid(body.id)) return fail("Pick a plan.");
      const { count } = await admin
        .from("staff_pay_settings")
        .select("staff_id", { count: "exact", head: true })
        .eq("organization_id", org)
        .eq("commission_plan_id", body.id);
      if (count) return fail("Someone is set to this plan. Move them first.");
      const { error } = await admin.from("commission_plans").update({ archived_at: now }).eq("id", body.id).eq("organization_id", org);
      return error ? fail("Couldn't save. Try again.", 500) : ok();
    }
    case "rule": {
      if (!isUuid(body.planId)) return fail("Pick a plan.");
      const percent = body.percent === "" || body.percent == null ? null : Number(body.percent);
      const flatCents = dollarsToCents(body.flat);
      const input = { category: String(body.category ?? ""), condition: String(body.condition ?? "any"), percent, flatCents };
      const problem = commissionRuleProblem(input);
      if (problem) return fail(problem);
      const { data: plan } = await admin
        .from("commission_plans")
        .select("id")
        .eq("id", body.planId)
        .eq("organization_id", org)
        .maybeSingle();
      if (!plan) return fail("Plan not found.", 404);
      const { error } = await admin
        .from("commission_rules")
        .upsert(
          {
            organization_id: org,
            plan_id: body.planId,
            category: input.category,
            condition: input.condition,
            percent,
            flat_cents: flatCents,
          },
          { onConflict: "plan_id,category,condition" },
        );
      return error ? fail("Couldn't save. Try again.", 500) : ok();
    }
    case "removeRule": {
      if (!isUuid(body.id)) return fail("Pick a rule.");
      const { error } = await admin.from("commission_rules").delete().eq("id", body.id).eq("organization_id", org);
      return error ? fail("Couldn't save. Try again.", 500) : ok();
    }
    case "person": {
      if (!isUuid(body.staffId)) return fail("Pick a person.");
      const planId = isUuid(body.planId) ? body.planId : null;
      const enabled = body.enabled === "on" ? true : body.enabled === "off" ? false : null;
      const { data: person } = await admin.from("staff").select("id").eq("id", body.staffId).eq("organization_id", org).maybeSingle();
      if (!person) return fail("Person not found.", 404);
      if (planId) {
        const { data: plan } = await admin.from("commission_plans").select("id").eq("id", planId).eq("organization_id", org).maybeSingle();
        if (!plan) return fail("Plan not found.", 404);
      }
      const { data: existing } = await admin.from("staff_pay_settings").select("staff_id").eq("staff_id", body.staffId).maybeSingle();
      const values = { commission_plan_id: planId, commission_enabled: enabled, updated_at: now, updated_by_staff_id: currentStaff.id };
      const { error } = existing
        ? await admin.from("staff_pay_settings").update(values).eq("staff_id", body.staffId)
        : await admin.from("staff_pay_settings").insert({ staff_id: body.staffId, organization_id: org, ...values });
      return error ? fail("Couldn't save. Try again.", 500) : ok();
    }
    case "handoff": {
      const detailId = Number(body.detailId);
      if (!Number.isInteger(detailId) || detailId <= 0) return fail("Pick a sale.");
      const { data: line } = await admin
        .from("member_sale_items")
        .select("mindbody_sale_id")
        .eq("organization_id", org)
        .eq("mindbody_sale_detail_id", detailId)
        .maybeSingle();
      if (!line) return fail("Sale not found.", 404);
      const { error } = await admin.from("commission_sale_flags").upsert({
        organization_id: org,
        mindbody_sale_detail_id: detailId,
        handoff_approved: body.approved === true,
        set_at: now,
        set_by_staff_id: currentStaff.id,
      });
      if (error) return fail("Couldn't save. Try again.", 500);
      const { data: sale } = await admin
        .from("member_sales")
        .select("sale_at")
        .eq("organization_id", org)
        .eq("mindbody_sale_id", line.mindbody_sale_id)
        .maybeSingle();
      if (sale?.sale_at) {
        const at = Date.parse(sale.sale_at as string);
        await computeCommissions(org, new Date(at - 1000).toISOString(), new Date(at + 1000).toISOString());
      }
      return ok();
    }
    case "recalc": {
      const valid = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
      if (!valid(body.from) || !valid(body.to)) return fail("Pick dates.");
      const { data: orgRow } = await admin.from("organizations").select("timezone").eq("id", org).maybeSingle();
      const zone = (orgRow?.timezone as string | null) ?? "America/Chicago";
      const from = DateTime.fromISO(body.from as string, { zone }).startOf("day");
      const to = DateTime.fromISO(body.to as string, { zone })
        .plus({ days: 1 })
        .startOf("day");
      if (to.diff(from, "days").days > 93) return fail("Recalculate up to three months at a time.");
      const result = await computeCommissions(org, from.toUTC().toISO()!, to.toUTC().toISO()!);
      return NextResponse.json({ success: true, ...result });
    }
    default:
      return fail("Unknown action.");
  }
}
