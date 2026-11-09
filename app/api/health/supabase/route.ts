import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();

    // Public, so it reports only whether the database answered -- no rows.
    const { error } = await supabase
      .from("class_occurrences")
      .select("id", { head: true, count: "exact" })
      .limit(1);

    if (error) {
      // Public route: log the detail, never return it.
      console.error("[health/supabase]", error.message);
      return NextResponse.json({ success: false, error: "Database check failed." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Supabase connection successful!",
    });
  } catch (err) {
    console.error("[health/supabase]", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Database check failed." }, { status: 500 });
  }
}