import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { applyNameSearch, searchTokens } from "@/lib/crm/search";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

// Guest search for the admin "Merge into…" picker. POST so names stay out
// of URLs.
export async function POST(request: NextRequest) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const body = await readJsonBody(request);
    const tokens = searchTokens(body?.q);
    if (tokens.length === 0 || tokens.join("").length < 2) return NextResponse.json({ success: true, results: [] });

    const admin = createSupabaseAdminClient();
    const base = admin
      .from("crm_contacts")
      .select("id, first_name, last_name, status, created_at")
      .eq("organization_id", staff.organizationId)
      .is("merged_into_id", null)
      .is("deleted_at", null);
    const { data, error } = await applyNameSearch(base, tokens)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      results: (data ?? []).map((row) => ({
        id: row.id,
        name: `${row.first_name} ${row.last_name}`,
        status: row.status,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    logCrmError("crm/contacts search", error);
    return jsonError("Search failed.", 500);
  }
}
