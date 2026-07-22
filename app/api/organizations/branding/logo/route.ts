import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";

const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json(
        { error: "Only an authenticated admin can update the organization logo." },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("logo");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "logo file is required." }, { status: 400 });
    }

    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type "${file.type}". Use PNG, JPEG, SVG, or WebP.` },
        { status: 400 },
      );
    }

    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: "Logo file must be 2MB or smaller." }, { status: 400 });
    }

    const supabase = await getScopedClient(currentStaff);

    // Fixed, extension-less key -- upsert always overwrites the same
    // object even when a later upload is a different format, so there's
    // never an orphaned old file left behind in the bucket.
    const objectKey = `${currentStaff.organizationId}/logo`;

    const { error: uploadError } = await supabase.storage
      .from("org-logos")
      .upload(objectKey, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: publicUrlData } = supabase.storage.from("org-logos").getPublicUrl(objectKey);

    // Cache-bust: the object key never changes on re-upload, so without a
    // query param the browser (and any CDN in front of Storage) would keep
    // serving the previous logo after a replace.
    const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { data, error: updateError } = await supabase
      .from("organizations")
      .update({ logo_url: logoUrl })
      .eq("id", currentStaff.organizationId)
      .select("logo_url")
      .single();

    if (updateError || !data) {
      throw new Error(updateError?.message ?? "Failed to save logo URL.");
    }

    return NextResponse.json({ success: true, logoUrl: data.logo_url });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
