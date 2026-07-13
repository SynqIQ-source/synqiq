import { NextResponse } from "next/server";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const mindbody = createMindbodyClient();
    const supabase = createSupabaseAdminClient();

    const result = await mindbody.getClasses();
    const classes = result.Classes ?? [];

    let imported = 0;

    for (const cls of classes) {
      const maxCapacity = cls.MaxCapacity ?? 0;
      const totalBooked = cls.TotalBooked ?? 0;

      const fillRate =
        maxCapacity > 0
          ? Number(((totalBooked / maxCapacity) * 100).toFixed(2))
          : 0;

      const { error } = await supabase
        .from("class_occurrences")
        .upsert(
          {
            mindbody_class_schedule_id: cls.ClassScheduleId,

            class_name: cls.ClassDescription?.Name ?? "Unknown",

            instructor_name:
              cls.Staff?.Name ??
              cls.Staff?.FirstName ??
              "Unknown",

            start_time: cls.StartDateTime,

            max_capacity: maxCapacity,
            web_capacity: cls.WebCapacity ?? 0,

            total_booked: totalBooked,
            total_signed_in: cls.TotalSignedIn ?? 0,

            fill_rate: fillRate,

            staff_id: null,
            department_id: null,
            room_id: null,
            substitute_staff_id: null,
          },
          {
            onConflict: "mindbody_class_schedule_id",
          }
        );

      if (!error) {
        imported++;
      } else {
        console.error(error);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      total: classes.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}