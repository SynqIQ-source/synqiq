import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { MindbodyClient, createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { delay, withRetry } from "@/lib/retry";
import type { MindbodyStaffMember } from "@/types/mindbody";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function syncLocations(mindbody: MindbodyClient, supabase: SupabaseAdminClient, accessToken: string, organizationId: string, timezone: string) {
  const result = await mindbody.getLocations(accessToken);
  const locations = result.Locations ?? [];
  const idMap = new Map<number, string>();

  for (const location of locations) {
    const { data, error } = await supabase
      .from("Locations")
      .upsert(
        {
          mindbody_location_id: location.Id,
          organization_id: organizationId,
          name: location.Name,
          timezone,
          active: location.HasClasses ?? true,
        },
        { onConflict: "mindbody_location_id" },
      )
      .select("id")
      .single();

    if (!error && data) {
      idMap.set(location.Id, data.id);
    } else if (error) {
      console.error(error);
    }
  }

  return idMap;
}

async function syncRooms(mindbody: MindbodyClient, supabase: SupabaseAdminClient, accessToken: string) {
  const result = await mindbody.getResources(accessToken);
  const resources = result.Resources ?? [];
  const idMap = new Map<number, string>();

  for (const resource of resources) {
    const { data, error } = await supabase
      .from("rooms")
      .upsert(
        {
          mindbody_resource_id: resource.Id,
          name: resource.Name,
          active: true,
        },
        { onConflict: "mindbody_resource_id" },
      )
      .select("id")
      .single();

    if (!error && data) {
      idMap.set(resource.Id, data.id);
    } else if (error) {
      console.error(error);
    }
  }

  return idMap;
}

async function syncDepartments(mindbody: MindbodyClient, supabase: SupabaseAdminClient, accessToken: string) {
  // Departments are sourced from MindBody's Program (via /class/classdescriptions),
  // not Category -- CategoryId is null on every class in this data, whereas
  // Program (Membership, Yoga, Boot Camp, ...) is always populated and is what
  // actually distinguishes classes. Paginate through the full site-wide
  // description list so departments aren't limited to whatever's in a given
  // sync's date window.
  const programs = new Map<number, string>();
  let offset = 0;
  const limit = 200;

  for (;;) {
    const page = await mindbody.getClassDescriptions(accessToken, { offset, limit });
    const descriptions = page.ClassDescriptions ?? [];

    for (const description of descriptions) {
      if (description.Program?.Id != null) {
        programs.set(description.Program.Id, description.Program.Name ?? "Unknown");
      }
    }

    offset += descriptions.length;
    const total = page.PaginationResponse?.TotalResults ?? 0;
    if (descriptions.length === 0 || offset >= total) {
      break;
    }
  }

  const idMap = new Map<number, string>();

  for (const [programId, programName] of programs) {
    const { data, error } = await supabase
      .from("departments")
      .upsert(
        {
          mindbody_program_id: programId,
          name: programName,
          active: true,
        },
        { onConflict: "mindbody_program_id" },
      )
      .select("id")
      .single();

    if (!error && data) {
      idMap.set(programId, data.id);
    } else if (error) {
      console.error(error);
    }
  }

  return idMap;
}

async function syncStaff(mindbody: MindbodyClient, supabase: SupabaseAdminClient, accessToken: string, organizationId: string) {
  // getStaff with no pagination params silently returns MindBody's default
  // page size, not the full roster -- confirmed empirically: two real
  // instructors (ids 100000237, 100000285) were missing from an unpaginated
  // call despite being present in the full 141-member roster. Paginate
  // through everything, same as syncDepartments does for classdescriptions.
  const allMembers: MindbodyStaffMember[] = [];
  let offset = 0;
  const limit = 200;

  for (;;) {
    const page = await mindbody.getStaff(accessToken, { offset, limit });
    const pageMembers = (page.StaffMembers ?? []) as MindbodyStaffMember[];
    allMembers.push(...pageMembers);

    offset += pageMembers.length;
    const total = page.PaginationResponse?.TotalResults ?? 0;
    if (pageMembers.length === 0 || offset >= total) {
      break;
    }
  }

  // MindBody's staff roster includes reserved/system placeholder accounts
  // (e.g. Id -5 "Autoemail", Id -4 "Client") with negative ids -- exclude them.
  const members = allMembers.filter((member) => member.Id > 0);
  const idMap = new Map<number, string>();

  for (const member of members) {
    const displayName =
      member.DisplayName ??
      member.Name ??
      ([member.FirstName, member.LastName].filter(Boolean).join(" ") || "Unknown");

    const { data, error } = await supabase
      .from("staff")
      .upsert(
        {
          mindbody_staff_id: member.Id,
          organization_id: organizationId,
          // MindBody has no per-staff location concept (confirmed empirically:
          // filtering /staff/staff by different LocationIds returns identical
          // results) -- location_id stays null.
          location_id: null,
          first_name: member.FirstName ?? "Unknown",
          last_name: member.LastName ?? "Unknown",
          display_name: displayName,
          email: member.Email,
          phone: member.MobilePhone ?? member.HomePhone ?? member.WorkPhone,
          active: !member.EmploymentEnd,
          hire_date: member.EmploymentStart,
          separation_date: member.EmploymentEnd,
        },
        { onConflict: "mindbody_staff_id" },
      )
      .select("id")
      .single();

    if (!error && data) {
      idMap.set(member.Id, data.id);
    } else if (error) {
      console.error(error);
    }
  }

  return idMap;
}

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

    // Reference data is synced from site-wide MindBody endpoints (not scoped
    // to the classes date window below), so staff/rooms/departments resolve
    // correctly regardless of which day is being synced.
    await syncLocations(mindbody, supabase, accessToken, org.id, org.timezone);
    const roomIdByResourceId = await syncRooms(mindbody, supabase, accessToken);
    const departmentIdByProgramId = await syncDepartments(mindbody, supabase, accessToken);
    const staffIdByMindbodyId = await syncStaff(mindbody, supabase, accessToken, org.id);

    // Paginate through every class in the window -- a single unpaginated
    // call silently truncates to MindBody's default page size (the same bug
    // fixed for /staff/staff: it looks like "it worked" while quietly
    // dropping most of the results). A small delay between pages and a
    // retry-with-backoff around each fetch keep this polite at the volume a
    // 90-day, all-locations sync pulls (roughly 1,000 classes / ~5 pages),
    // and give it a chance to recover from a transient MindBody hiccup
    // instead of failing the whole sync outright.
    let imported = 0;
    let totalClasses = 0;
    let offset = 0;
    const pageLimit = 200;

    for (;;) {
      const page = await withRetry(() =>
        mindbody.getClasses(accessToken, {
          startDateTime,
          endDateTime,
          locationId,
          offset,
          limit: pageLimit,
        }),
      );
      const classes = page.Classes ?? [];
      totalClasses = page.PaginationResponse?.TotalResults ?? classes.length;

      for (const cls of classes) {
        const maxCapacity = cls.MaxCapacity ?? 0;
        const totalBooked = cls.TotalBooked ?? 0;

        const fillRate =
          maxCapacity > 0
            ? Number(((totalBooked / maxCapacity) * 100).toFixed(2))
            : 0;

        const startDateTimeUtc = DateTime.fromISO(cls.StartDateTime, {
          zone: org.timezone,
        }).toUTC();
        const startDatetime = startDateTimeUtc.toISO();

        const endDatetime = cls.EndDateTime
          ? DateTime.fromISO(cls.EndDateTime, { zone: org.timezone }).toUTC().toISO()
          : null;

        // Same eligibility rule verified on the dashboard: only meaningful for
        // classes that have already happened and had at least one booking.
        // An upcoming class has 0 sign-ins because check-in hasn't occurred
        // yet, not because of a no-show, and a class nobody booked has no
        // attendance concept at all -- both stay null rather than 0.
        const attendanceRate =
          totalBooked > 0 && startDateTimeUtc <= DateTime.utc()
            ? Number((((cls.TotalSignedIn ?? 0) / totalBooked) * 100).toFixed(2))
            : null;

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
              end_datetime: endDatetime,

              max_capacity: maxCapacity,
              web_capacity: cls.WebCapacity ?? 0,

              total_booked: totalBooked,
              total_signed_in: cls.TotalSignedIn ?? 0,

              fill_rate: fillRate,
              attendance_rate: attendanceRate,

              staff_id: cls.Staff?.Id != null ? staffIdByMindbodyId.get(cls.Staff.Id) ?? null : null,
              department_id:
                cls.ClassDescription?.Program?.Id != null
                  ? departmentIdByProgramId.get(cls.ClassDescription.Program.Id) ?? null
                  : null,
              room_id: cls.Resource?.Id != null ? roomIdByResourceId.get(cls.Resource.Id) ?? null : null,
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

      offset += classes.length;
      if (classes.length === 0 || offset >= totalClasses) {
        break;
      }

      // Courtesy pacing between MindBody page fetches, not needed between
      // the Supabase upserts above (different service, no shared limit).
      await delay(300);
    }

    return NextResponse.json({
      success: true,
      imported,
      total: totalClasses,
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
