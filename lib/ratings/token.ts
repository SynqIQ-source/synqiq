import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/member/password";

// The rating request behind an emailed link (by token hash), with what the
// rating page shows. Service role; the token is the only key.
export async function findRatingRequest(token: string) {
  if (!token || token.length > 200) return null;
  const admin = createSupabaseAdminClient();
  const { data: request } = await admin
    .from("rating_requests")
    .select(
      "id, organization_id, mindbody_client_id, client_name, staff_id, class_occurrence_id, class_name, class_style, class_start, quarter, status, expires_at",
    )
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!request) return null;
  const [{ data: org }, { data: staff }] = await Promise.all([
    admin.from("organizations").select("name, timezone, logo_url, primary_color").eq("id", request.organization_id).maybeSingle(),
    admin.from("staff").select("display_name").eq("id", request.staff_id).maybeSingle(),
  ]);
  return {
    request,
    studio: {
      name: (org?.name as string | null) ?? "Your studio",
      timezone: (org?.timezone as string | null) ?? "America/Chicago",
      logoUrl: (org?.logo_url as string | null) ?? null,
      color: (org?.primary_color as string | null) ?? "#0f766e",
    },
    instructor: ((staff?.display_name as string | null) ?? "your instructor").split(" ")[0],
    open: request.status === "sent" && Boolean(request.expires_at) && Date.parse(request.expires_at as string) > Date.now(),
  };
}
