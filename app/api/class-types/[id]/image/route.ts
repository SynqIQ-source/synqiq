import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "class-images";

// Photo for a class type (Club Admin), shown on the member app and the
// public widget. POST multipart "image" to set, DELETE to remove.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return fail("Class not found.", 404);
  const org = auth.currentStaff.organizationId;
  const admin = createSupabaseAdminClient();
  const { data: type } = await admin.from("class_types").select("id, image_url").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!type) return fail("Class not found.", 404);
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return fail("Choose a photo.");
  const extension = TYPES[file.type];
  if (!extension) return fail("Use a PNG, JPEG or WebP photo.");
  if (file.size > MAX_BYTES) return fail("Photos must be 5 MB or smaller.");
  const key = `${org}/${id}-${Date.now()}.${extension}`;
  const { error } = await admin.storage.from(BUCKET).upload(key, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[class-types/image] upload failed:", error.message);
    return fail("Couldn't upload. Try again.", 500);
  }
  const url = admin.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
  await admin.from("class_types").update({ image_url: url }).eq("id", id);
  await removeOld(admin, type.image_url as string | null);
  return NextResponse.json({ success: true, imageUrl: url });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return fail("Class not found.", 404);
  const admin = createSupabaseAdminClient();
  const { data: type } = await admin
    .from("class_types")
    .select("id, image_url")
    .eq("id", id)
    .eq("organization_id", auth.currentStaff.organizationId)
    .maybeSingle();
  if (!type) return fail("Class not found.", 404);
  await admin.from("class_types").update({ image_url: null }).eq("id", id);
  await removeOld(admin, type.image_url as string | null);
  return NextResponse.json({ success: true });
}

async function removeOld(admin: ReturnType<typeof createSupabaseAdminClient>, url: string | null) {
  const key = url?.split(`/${BUCKET}/`)[1];
  if (key) await admin.storage.from(BUCKET).remove([decodeURIComponent(key)]);
}
