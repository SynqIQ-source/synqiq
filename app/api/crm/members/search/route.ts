import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { applyNameSearch, searchTokens } from "@/lib/crm/search";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

// Member search for "Add referring member" on a guest's profile: synced
// Mindbody clients with an Active membership. Staff-only (admins and
// sellers); the kiosk never sees member data. POST so names stay out of URLs.
export async function POST(request: NextRequest) {
  try {
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const body = await readJsonBody(request);
    const tokens = searchTokens(body?.q);
    if (tokens.length === 0 || tokens.join("").length < 2) return NextResponse.json({ success: true, results: [] });

    const admin = createSupabaseAdminClient();
    const base = admin
      .from("clients")
      .select("id, first_name, last_name, mindbody_unique_id")
      .eq("organization_id", staff.organizationId)
      .eq("status", "Active");
    const { data, error } = await applyNameSearch(base, tokens).order("last_name").limit(10);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      results: (data ?? []).map((row) => ({
        id: row.id,
        name: `${row.first_name} ${row.last_name}`,
        mindbodyId: row.mindbody_unique_id,
      })),
    });
  } catch (error) {
    logCrmError("crm/members search", error);
    return jsonError("Search failed.", 500);
  }
}
