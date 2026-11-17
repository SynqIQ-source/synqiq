import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MEDIA_BUCKET } from "@/lib/maintenance/server";

type RouteParams = { params: Promise<{ id: string; mediaId: string }> };

async function findMedia(organizationId: string, issueId: string, mediaId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return null;
  const { data } = await createSupabaseAdminClient()
    .from("maintenance_media")
    .select("id, path, uploaded_by_staff_id, uploaded_at")
    .eq("id", mediaId)
    .eq("issue_id", issueId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data;
}

// The phone finished uploading: confirm the file is in the bucket.
export async function PATCH(_request: Request, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ success: false, error: "Sign in first." }, { status: 401 });
  const { id, mediaId } = await params;
  const media = await findMedia(staff.organizationId, id, mediaId);
  if (!media) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const admin = createSupabaseAdminClient();
  const path = media.path as string;
  const folder = path.slice(0, path.lastIndexOf("/"));
  const { data: files } = await admin.storage.from(MEDIA_BUCKET).list(folder, { search: path.slice(path.lastIndexOf("/") + 1) });
  if (!files?.length) return NextResponse.json({ success: false, error: "The upload didn't finish. Try again." }, { status: 400 });
  await admin.from("maintenance_media").update({ uploaded_at: new Date().toISOString() }).eq("id", mediaId);
  return NextResponse.json({ success: true });
}

// Remove a photo/video: whoever added it, or a Club Admin. Also used to
// clean up an upload that failed.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ success: false, error: "Sign in first." }, { status: 401 });
  const { id, mediaId } = await params;
  const media = await findMedia(staff.organizationId, id, mediaId);
  if (!media) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  if (staff.role !== "admin" && media.uploaded_by_staff_id !== staff.id) {
    return NextResponse.json({ success: false, error: "Only whoever added it or a Club Admin can remove it." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  await admin.storage.from(MEDIA_BUCKET).remove([media.path as string]);
  await admin.from("maintenance_media").delete().eq("id", mediaId);
  return NextResponse.json({ success: true });
}
