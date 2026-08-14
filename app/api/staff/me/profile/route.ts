import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_FIELD_LENGTH = 200;

// Self-service profile edit (display_name, title) for the signed-in staff
// member's own row. Admin client, not getScopedClient -- staff has no RLS
// UPDATE policy at all (same situation as the invite/role routes), so this
// route's own "only your own row, only these two columns" check is the real
// authorization boundary. role is deliberately never accepted here: this is
// the self-service path, not the admin one at /api/staff/[id]/role.
export async function PATCH(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const displayName: unknown = body?.displayName;
    const title: unknown = body?.title;

    const updates: Record<string, string | null> = {};

    if (displayName !== undefined) {
      if (typeof displayName !== "string" || !displayName.trim()) {
        return NextResponse.json({ error: "displayName cannot be empty." }, { status: 400 });
      }
      if (displayName.length > MAX_FIELD_LENGTH) {
        return NextResponse.json(
          { error: `displayName must be ${MAX_FIELD_LENGTH} characters or fewer.` },
          { status: 400 },
        );
      }
      updates.display_name = displayName.trim();
    }

    if (title !== undefined) {
      if (title !== null && typeof title !== "string") {
        return NextResponse.json({ error: "title must be a string or null." }, { status: 400 });
      }
      if (typeof title === "string" && title.length > MAX_FIELD_LENGTH) {
        return NextResponse.json(
          { error: `title must be ${MAX_FIELD_LENGTH} characters or fewer.` },
          { status: 400 },
        );
      }
      updates.title = typeof title === "string" ? title.trim() || null : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields provided." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from("staff")
      .update(updates)
      .eq("id", currentStaff.id)
      .select("id, display_name, title, photo_url, role")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update profile.");
    }

    return NextResponse.json({ success: true, staff: data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
