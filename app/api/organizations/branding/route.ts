import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { isAllowedFont } from "@/lib/fonts";

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    // Explicit check, not just relying on RLS to silently no-op the update --
    // same defense-in-depth pattern as the substitute-selection route: RLS
    // (organizations_update_admin) is the real boundary, but a clear 403
    // beats a mysterious "success" with zero rows actually changed.
    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json(
        { error: "Only an authenticated admin can update organization branding." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const primaryColor: string | undefined = body?.primaryColor;
    const accentColor: string | undefined = body?.accentColor;
    const fontFamily: string | undefined = body?.fontFamily;

    if (primaryColor !== undefined && !HEX_COLOR_PATTERN.test(primaryColor)) {
      return NextResponse.json(
        { error: "primaryColor must be a 6-digit hex color, e.g. #0f766e." },
        { status: 400 },
      );
    }

    if (accentColor !== undefined && !HEX_COLOR_PATTERN.test(accentColor)) {
      return NextResponse.json(
        { error: "accentColor must be a 6-digit hex color, e.g. #0f766e." },
        { status: 400 },
      );
    }

    if (fontFamily !== undefined && !isAllowedFont(fontFamily)) {
      return NextResponse.json(
        { error: "fontFamily must be one of the allowed fonts." },
        { status: 400 },
      );
    }

    const updates: Record<string, string> = {};
    if (primaryColor !== undefined) updates.primary_color = primaryColor;
    if (accentColor !== undefined) updates.accent_color = accentColor;
    if (fontFamily !== undefined) updates.font_family = fontFamily;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No branding fields provided." }, { status: 400 });
    }

    const supabase = await getScopedClient(currentStaff);

    const { data, error } = await supabase
      .from("organizations")
      .update(updates)
      .eq("id", currentStaff.organizationId)
      .select("primary_color, accent_color, font_family")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update organization branding.");
    }

    return NextResponse.json({ success: true, branding: data });
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
