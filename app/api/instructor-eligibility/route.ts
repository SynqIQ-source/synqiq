import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";

// Admin-facing read/write for instructor_class_eligibility -- the table has
// existed since the substitution workflow shipped (seeded once from 90 days
// of teaching history, RLS already allows admin insert/update), but nothing
// in the app ever exposed a way to actually change a row after that seed.
// This is that missing piece: given a department, list every class_name
// that's actually occurred there plus every instructor, so an admin can see
// and toggle who's eligible -- including someone the 90-day seed missed
// entirely (a newer hire, for instance).

export async function GET(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json({ error: "Admin sign-in required." }, { status: 403 });
    }

    const departmentId = request.nextUrl.searchParams.get("departmentId");

    if (!departmentId) {
      return NextResponse.json({ error: "departmentId is required." }, { status: 400 });
    }

    const supabase = await getScopedClient(currentStaff);

    const [instructorsResult, classNamesResult, eligibilityResult] = await Promise.all([
      supabase.from("staff").select("id, display_name").eq("role", "instructor").order("display_name"),
      supabase
        .from("class_occurrences")
        .select("class_name")
        .eq("department_id", departmentId)
        .not("class_name", "is", null),
      supabase
        .from("instructor_class_eligibility")
        .select("staff_id, class_name, enabled")
        .eq("department_id", departmentId),
    ]);

    if (instructorsResult.error) {
      throw new Error(instructorsResult.error.message);
    }
    if (classNamesResult.error) {
      throw new Error(classNamesResult.error.message);
    }
    if (eligibilityResult.error) {
      throw new Error(eligibilityResult.error.message);
    }

    // Distinct + sorted here rather than in SQL -- class_occurrences has no
    // DISTINCT-friendly index for this and the per-department row count is
    // small enough that doing it in JS is simpler than a second RPC.
    const classNames = [...new Set(classNamesResult.data.map((row) => row.class_name as string))].sort(
      (a, b) => a.localeCompare(b),
    );

    return NextResponse.json({
      instructors: instructorsResult.data,
      classNames,
      eligibility: eligibilityResult.data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json({ error: "Admin sign-in required." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const staffId: unknown = body?.staffId;
    const departmentId: unknown = body?.departmentId;
    const className: unknown = body?.className;
    const enabled: unknown = body?.enabled;

    if (
      typeof staffId !== "string" ||
      typeof departmentId !== "string" ||
      typeof className !== "string" ||
      !className.trim() ||
      typeof enabled !== "boolean"
    ) {
      return NextResponse.json(
        { error: "staffId, departmentId, className, and enabled (boolean) are required." },
        { status: 400 },
      );
    }

    const supabase = await getScopedClient(currentStaff);

    const { error } = await supabase.from("instructor_class_eligibility").upsert(
      {
        staff_id: staffId,
        department_id: departmentId,
        class_name: className.trim(),
        enabled,
        updated_by: currentStaff.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "staff_id,department_id,class_name" },
    );

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
