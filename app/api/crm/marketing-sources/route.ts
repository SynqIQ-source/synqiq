import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { cleanText } from "@/lib/crm/normalize";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

// Adds a "How did you hear about us?" option.
export async function POST(request: NextRequest) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const body = await readJsonBody(request);
    const label = cleanText(body?.label, 60);
    if (!label) return jsonError("Enter a name (up to 60 characters).", 400);

    const admin = createSupabaseAdminClient();
    const { data: last, error: lastError } = await admin
      .from("crm_marketing_sources")
      .select("sort_order")
      .eq("organization_id", staff.organizationId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw lastError;

    const { error } = await admin.from("crm_marketing_sources").insert({
      organization_id: staff.organizationId,
      label,
      sort_order: (last?.sort_order ?? 0) + 1,
    });
    if (error?.code === "23505") return jsonError("That option already exists.", 409);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    logCrmError("crm/marketing-sources POST", error);
    return jsonError("Couldn't add the option.", 500);
  }
}
