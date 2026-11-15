import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { seesOnlyOwnSales } from "@/lib/permissions";
import { applyNameSearch, searchTokens } from "@/lib/crm/search";
import { normalizeEmail, normalizePhone } from "@/lib/crm/normalize";
import { STATUS_LABELS } from "@/lib/crm/labels";

// Type-ahead lead search for Lead Status and Guests (the same dropdown as
// check-in): name, email or phone. Sales see only their own leads.
export async function GET(request: NextRequest) {
  const staff = await getCrmStaffForApi();
  if (!staff) return NextResponse.json({ success: false, members: [] }, { status: 404 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const email = normalizeEmail(q);
  const digits = q.replace(/\D/g, "");
  const phone = digits.length >= 7 ? normalizePhone(q) : null;
  const tokens = searchTokens(q);
  if (!email && !phone && (tokens.length === 0 || tokens.join("").length < 2)) return NextResponse.json({ success: true, members: [] });

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("crm_contacts")
    .select("id, first_name, last_name, status, phone_e164, assigned_staff_id")
    .eq("organization_id", staff.organizationId)
    .is("merged_into_id", null)
    .is("deleted_at", null);
  if (seesOnlyOwnSales(staff)) query = query.eq("assigned_staff_id", staff.id);
  query = email ? query.eq("email_normalized", email) : phone ? query.eq("phone_e164", phone) : applyNameSearch(query, tokens);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(10);
  if (error) return NextResponse.json({ success: false, members: [] }, { status: 500 });

  const ownerIds = [...new Set((data ?? []).map((row) => row.assigned_staff_id).filter(Boolean))] as string[];
  const { data: owners } = ownerIds.length ? await admin.from("staff").select("id, display_name").in("id", ownerIds) : { data: [] };
  const ownerName = new Map((owners ?? []).map((row) => [row.id as string, row.display_name as string]));
  return NextResponse.json({
    success: true,
    members: (data ?? []).map((row) => ({
      id: row.id as string,
      name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
      status: STATUS_LABELS[row.status as string] ?? (row.status as string),
      plans: [] as string[],
      // Last 4 digits only, to tell two people with the same name apart.
      detail: [
        row.phone_e164 ? `…${String(row.phone_e164).slice(-4)}` : null,
        row.assigned_staff_id ? (ownerName.get(row.assigned_staff_id as string) ?? null) : "Unassigned",
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  });
}
