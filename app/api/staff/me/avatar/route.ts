import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

// Mirrors app/api/organizations/branding/logo/route.ts, keyed on the
// uploader's own staff id instead of admin+org. The storage upload itself
// uses the RLS-scoped client -- staff_avatars_insert_own/update_own already
// enforce the {staff_id}/avatar path convention there. The staff.photo_url
// write afterward needs the admin client though: staff has no RLS UPDATE
// policy at all (same situation as /api/staff/me/profile), so a scoped
// client's UPDATE would silently affect zero rows.
export async function POST(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("avatar");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "avatar file is required." }, { status: 400 });
    }

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type "${file.type}". Use PNG, JPEG, or WebP.` },
        { status: 400 },
      );
    }

    if (file.size > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: "Avatar file must be 2MB or smaller." }, { status: 400 });
    }

    const supabase = await getScopedClient(currentStaff);

    // Fixed, extension-less key -- upsert always overwrites the same
    // object, so there's never an orphaned old avatar left in the bucket.
    const objectKey = `${currentStaff.id}/avatar`;

    const { error: uploadError } = await supabase.storage
      .from("staff-avatars")
      .upload(objectKey, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: publicUrlData } = supabase.storage.from("staff-avatars").getPublicUrl(objectKey);

    // Cache-bust: the object key never changes on re-upload, so without a
    // query param the browser (and any CDN in front of Storage) would keep
    // serving the previous avatar after a replace.
    const photoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const admin = createSupabaseAdminClient();
    const { data, error: updateError } = await admin
      .from("staff")
      .update({ photo_url: photoUrl })
      .eq("id", currentStaff.id)
      .select("photo_url")
      .single();

    if (updateError || !data) {
      throw new Error(updateError?.message ?? "Failed to save avatar URL.");
    }

    return NextResponse.json({ success: true, photoUrl: data.photo_url });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
