import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkMediaUpload, type ExistingMedia } from "@/lib/maintenance/rules";
import { MEDIA_BUCKET, loadIssue } from "@/lib/maintenance/server";

type RouteParams = { params: Promise<{ id: string }> };

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

// Staff add a photo or video to a report: checked against the limits (8
// photos; 2 videos, 30 seconds in total), then the phone uploads straight to
// the private bucket with a one-time signed link (too big to pass through
// the server). The upload is confirmed with PATCH .../media/[mediaId].
export async function POST(request: NextRequest, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ success: false, error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const loaded = await loadIssue(admin, staff.organizationId, id);
  if (!loaded) return NextResponse.json({ success: false, error: "Report not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { contentType?: unknown; sizeBytes?: unknown; durationSeconds?: unknown } | null;
  const contentType = typeof body?.contentType === "string" ? body.contentType.toLowerCase() : "";
  const sizeBytes = Number(body?.sizeBytes);
  const durationSeconds = body?.durationSeconds == null ? null : Number(body.durationSeconds);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0)
    return NextResponse.json({ success: false, error: "That file is empty." }, { status: 400 });

  const { data: existing } = await admin.from("maintenance_media").select("kind, duration_seconds").eq("issue_id", id);
  const check = checkMediaUpload((existing ?? []) as ExistingMedia[], { contentType, sizeBytes, durationSeconds });
  if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: 400 });

  const path = `${staff.organizationId}/${id}/${randomBytes(10).toString("hex")}.${EXTENSIONS[contentType] ?? "bin"}`;
  const { data: signed, error: signError } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (signError || !signed) {
    console.error("[maintenance] signed upload failed:", signError?.message);
    return NextResponse.json({ success: false, error: "Couldn't start the upload. Try again." }, { status: 500 });
  }
  const { data: media, error } = await admin
    .from("maintenance_media")
    .insert({
      organization_id: staff.organizationId,
      issue_id: id,
      kind: check.kind,
      path,
      content_type: contentType,
      size_bytes: Math.round(sizeBytes),
      duration_seconds: check.kind === "video" ? durationSeconds : null,
      uploaded_by_staff_id: staff.id,
    })
    .select("id")
    .single();
  if (error || !media) return NextResponse.json({ success: false, error: "Couldn't start the upload. Try again." }, { status: 500 });
  return NextResponse.json({ success: true, mediaId: media.id, bucket: MEDIA_BUCKET, path, token: signed.token });
}
