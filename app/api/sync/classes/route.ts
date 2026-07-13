import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDateTime = searchParams.get("startDateTime") ?? undefined;
    const endDateTime = searchParams.get("endDateTime") ?? undefined;
    const locationIdParam = searchParams.get("locationId");
    const locationId = locationIdParam ? Number(locationIdParam) : undefined;

    const mindbody = createMindbodyClient();
    const supabase = createSupabaseAdminClient();

    const { AccessToken: accessToken } = await mindbody.authenticate();

    // MindBody exposes one IANA timezone per site (GET /site/sites), not per
    // Location. Resolve it once per sync run and use it to interpret every
    // class's naive local StartDateTime -- guessing a fixed timezone here
    // would silently corrupt data for any studio not in that timezone.
    const siteResult = await mindbody.getSite(accessToken);
    const site = siteResult.Sites?.[0];

    if (!site) {
      throw new Error("MindBody /site/sites returned no site.");
    }

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .upsert(
        {
          mindbody_site_id: site.Id,
          timezone: site.TimeZone,
          name: site.Name,
        },
        { onConflict: "mindbody_site_id" },
      )
      .select()
      .single();

    if (orgError || !org) {
      throw new Error(orgError?.message ?? "Failed to upsert organization.");
    }

    const result = await mindbody.getClasses(accessToken, { startDateTime, endDateTime, locationId });
    const classes = result.Classes ?? [];

    let imported = 0;

    for (const cls of classes) {
      const maxCapacity = cls.MaxCapacity ?? 0;
      const totalBooked = cls.TotalBooked ?? 0;

      const fillRate =
        maxCapacity > 0
          ? Number(((totalBooked / maxCapacity) * 100).toFixed(2))
          : 0;

      const startDatetime = DateTime.fromISO(cls.StartDateTime, {
        zone: org.timezone,
      })
        .toUTC()
        .toISO();

      const { error } = await supabase
        .from("class_occurrences")
        .upsert(
          {
            // MindBody's occurrence-level Id: the true unique per-class-instance
            // identifier, stable across re-syncs. Do not confuse with
            // ClassScheduleId, which identifies the recurring series and is
            // shared by every occurrence of that series.
            mindbody_occurrence_id: cls.Id,
            mindbody_class_schedule_id: cls.ClassScheduleId,
            organization_id: org.id,

            class_name: cls.ClassDescription?.Name ?? "Unknown",

            instructor_name:
              cls.Staff?.Name ??
              cls.Staff?.FirstName ??
              "Unknown",

            start_datetime: startDatetime,

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
            onConflict: "mindbody_occurrence_id",
          },
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
      { status: 500 },
    );
  }
}
