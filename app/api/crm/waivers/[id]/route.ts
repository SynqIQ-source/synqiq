import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

const SIGNED_URL_SECONDS = 60;

// Downloads a signed waiver PDF through a 60-second signed URL. Both the
// row lookup and the signed URL go through the staff member's own session,
// so RLS (same org, admin or seller) is what grants access -- not just this
// route's check. The URL carries only the signature's id.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const staff = await getCrmStaffForApi();
    if (!staff) return jsonError("Not found.", 404);

    const { id } = await params;
    if (!isUuid(id)) return jsonError("Waiver not found.", 404);

    const supabase = await createSupabaseServerClient();
    const { data: signature, error } = await supabase
      .from("waiver_signatures")
      .select("pdf_path")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!signature) return jsonError("Waiver not found.", 404);

    const { data: signed, error: signError } = await supabase.storage
      .from("crm-private")
      .createSignedUrl(signature.pdf_path, SIGNED_URL_SECONDS, { download: `waiver-${id.slice(0, 8)}.pdf` });
    if (signError || !signed) throw signError ?? new Error("no signed url");

    const response = NextResponse.redirect(signed.signedUrl, 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logCrmError("crm/waivers GET", error);
    return jsonError("Couldn't open the waiver.", 500);
  }
}
