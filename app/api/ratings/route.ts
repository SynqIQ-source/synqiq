import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanRating } from "@/lib/ratings/rules";
import { findRatingRequest } from "@/lib/ratings/token";
import { sameOrigin } from "@/lib/member/session";

// From the rating page (no sign-in; the emailed token is the key):
//   { token, stars, comment? }  saves the rating (once)
//   { token, stop: true }       no more rating emails for this member
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { token?: unknown; stars?: unknown; comment?: unknown; stop?: unknown } | null;
  const token = typeof body?.token === "string" ? decodeURIComponent(body.token) : "";
  const found = await findRatingRequest(token);
  if (!found) return NextResponse.json({ success: false, error: "This link isn't valid anymore." }, { status: 404 });
  const { request: req } = found;
  const admin = createSupabaseAdminClient();

  if (body?.stop === true) {
    await admin
      .from("rating_opt_outs")
      .upsert(
        { organization_id: req.organization_id, mindbody_client_id: req.mindbody_client_id },
        { onConflict: "organization_id,mindbody_client_id" },
      );
    await admin
      .from("rating_requests")
      .update({ status: "skipped", skip_reason: "Member stopped rating emails" })
      .eq("organization_id", req.organization_id)
      .eq("mindbody_client_id", req.mindbody_client_id)
      .eq("status", "queued");
    return NextResponse.json({ success: true });
  }

  if (!found.open) return NextResponse.json({ success: false, error: "This link has expired." }, { status: 400 });
  const rating = cleanRating({ stars: body?.stars, comment: body?.comment });
  if ("error" in rating) return NextResponse.json({ success: false, error: rating.error }, { status: 400 });
  // Claim the request first so a double tap can't rate twice.
  const { data: claimed } = await admin
    .from("rating_requests")
    .update({ status: "rated", token_hash: null })
    .eq("id", req.id)
    .eq("status", "sent")
    .select("id");
  if (!claimed?.length) return NextResponse.json({ success: false, error: "We already have your rating. Thanks!" }, { status: 400 });
  const { error } = await admin.from("class_ratings").insert({
    organization_id: req.organization_id,
    request_id: req.id,
    staff_id: req.staff_id,
    mindbody_client_id: req.mindbody_client_id,
    client_name: req.client_name,
    class_name: req.class_name,
    class_style: req.class_style,
    class_start: req.class_start,
    quarter: req.quarter,
    stars: rating.stars,
    comment: rating.comment,
  });
  if (error) {
    console.error("[ratings] save failed:", error.message);
    return NextResponse.json({ success: false, error: "Couldn't save. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
