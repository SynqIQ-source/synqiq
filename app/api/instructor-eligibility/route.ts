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

const PAGE_SIZE = 1000;

// Distinct + sorted in JS rather than SQL -- class_occurrences has no
// DISTINCT-friendly index for this. Paged: Supabase caps an unranged select
// at 1000 rows and Membership GX Classes alone is past that, so an unpaged
// read silently dropped whichever class names fell outside the first 1000
// rows (a newer format like "Beat" being the most likely casualty). Trimmed
// because eligibility rows are stored trimmed -- " Mat Fusion" in
// class_occurrences has to match "Mat Fusion" in the eligibility table or
// its toggles all render as off.
async function loadDistinctClassNames(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
  departmentId: string,
): Promise<string[]> {
  const names = new Set<string>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("class_occurrences")
      .select("class_name")
      .eq("department_id", departmentId)
      .not("class_name", "is", null)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }
    for (const row of data) {
      const name = (row.class_name as string).trim();
      if (name) {
        names.add(name);
      }
    }
    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

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

    const [instructorsResult, classNames, eligibilityResult] = await Promise.all([
      supabase
        .from("staff")
        .select("id, display_name")
        .eq("role", "instructor")
        // Archived (let-go / inactive) instructors are gone from Staff
        // Logins -- keep them off this list too instead of leaving a
        // stale toggle row visible for someone no longer here. A deleted
        // instructor is already gone from `staff` entirely, no filter
        // needed for that case.
        .is("archived_at", null)
        .order("display_name"),
      loadDistinctClassNames(supabase, departmentId),
      supabase
        .from("instructor_class_eligibility")
        .select("staff_id, class_name, enabled")
        .eq("department_id", departmentId),
    ]);

    if (instructorsResult.error) {
      throw new Error(instructorsResult.error.message);
    }
    if (eligibilityResult.error) {
      throw new Error(eligibilityResult.error.message);
    }

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
