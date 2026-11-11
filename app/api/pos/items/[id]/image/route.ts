import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fail, isUuid, requireClubAdminApi } from "@/lib/payroll/api";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 3 * 1024 * 1024;

// Picture for a checkout card (Club Admin). POST multipart "image" to set,
// DELETE to remove. Stored in the public pos-images bucket.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return fail("Item not found.", 404);
  const org = auth.currentStaff.organizationId;
  const admin = createSupabaseAdminClient();
  const { data: item } = await admin.from("pos_items").select("id, image_url").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!item) return fail("Item not found.", 404);
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return fail("Choose a picture.");
  const extension = TYPES[file.type];
  if (!extension) return fail("Use a PNG, JPEG or WebP picture.");
  if (file.size > MAX_BYTES) return fail("Pictures must be 3 MB or smaller.");
  const key = `${org}/${id}-${Date.now()}.${extension}`;
  const { error } = await admin.storage.from("pos-images").upload(key, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[pos/image] upload failed:", error.message);
    return fail("Couldn't upload. Try again.", 500);
  }
  const url = admin.storage.from("pos-images").getPublicUrl(key).data.publicUrl;
  await admin.from("pos_items").update({ image_url: url, updated_at: new Date().toISOString() }).eq("id", id);
  await removeOld(admin, item.image_url as string | null);
  return NextResponse.json({ success: true, imageUrl: url });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClubAdminApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return fail("Item not found.", 404);
  const admin = createSupabaseAdminClient();
  const { data: item } = await admin
    .from("pos_items")
    .select("id, image_url")
    .eq("id", id)
    .eq("organization_id", auth.currentStaff.organizationId)
    .maybeSingle();
  if (!item) return fail("Item not found.", 404);
  await admin.from("pos_items").update({ image_url: null, updated_at: new Date().toISOString() }).eq("id", id);
  await removeOld(admin, item.image_url as string | null);
  return NextResponse.json({ success: true });
}

async function removeOld(admin: ReturnType<typeof createSupabaseAdminClient>, url: string | null) {
  const key = url?.split("/pos-images/")[1];
  if (key) await admin.storage.from("pos-images").remove([decodeURIComponent(key)]);
}
