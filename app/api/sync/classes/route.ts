import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { MindbodyClient, createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { delay, withRetry } from "@/lib/retry";
import { getEnv } from "@/lib/env";
import type { MindbodyStaffMember } from "@/types/mindbody";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function syncLocations(mindbody: MindbodyClient, supabase: SupabaseAdminClient, organizationId: string, timezone: string) {
  const result = await mindbody.getLocations();
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
        { onConflict: "organization_id,mindbody_location_id" },
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

async function syncRooms(mindbody: MindbodyClient, supabase: SupabaseAdminClient, organizationId: string) {
  const result = await mindbody.getResources();
  const resources = result.Resources ?? [];
  const idMap = new Map<number, string>();

  for (const resource of resources) {
    const { data, error } = await supabase
      .from("rooms")
      .upsert(
        {
          mindbody_resource_id: resource.Id,
          organization_id: organizationId,
          name: resource.Name,
          active: true,
        },
        { onConflict: "organization_id,mindbody_resource_id" },
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

async function syncDepartments(mindbody: MindbodyClient, supabase: SupabaseAdminClient, organizationId: string) {
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
    const page = await mindbody.getClassDescriptions(undefined, { offset, limit });
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
          organization_id: organizationId,
          name: programName,
          active: true,
        },
        { onConflict: "organization_id,mindbody_program_id" },
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

async function syncStaff(mindbody: MindbodyClient, supabase: SupabaseAdminClient, organizationId: string) {
  // getStaff with no pagination params silently returns MindBody's default
  // page size, not the full roster -- confirmed empirically: two real
  // instructors (ids 100000237, 100000285) were missing from an unpaginated
  // call despite being present in the full 141-member roster. Paginate
  // through everything, same as syncDepartments does for classdescriptions.
  const allMembers: MindbodyStaffMember[] = [];
  let offset = 0;
  const limit = 200;

  for (;;) {
    const page = await mindbody.getStaff(undefined, { offset, limit });
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
        { onConflict: "organization_id,mindbody_staff_id" },
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
    // This route writes to the DB and calls the MindBody API on every hit,
    // and is now wired to Vercel Cron (see vercel.json) rather than only
    // ever being triggered by hand -- leaving it unauthenticated would make
    // it a public trigger for both. Vercel attaches this same bearer token
    // automatically on cron-invoked requests once CRON_SECRET is set in the
    // project's env vars; manual/local calls must pass it explicitly the
    // same way.
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const mindbody = createMindbodyClient();
    const supabase = createSupabaseAdminClient();
    const configuredSiteId = Number(getEnv("MINDBODY_SITE_ID"));

    // The nightly cron hits this route with no query params at all -- that's
    // what distinguishes an automatic run from someone deliberately
    // requesting a specific window.
    const isCronDefaultRun = !searchParams.has("startDateTime") && !searchParams.has("endDateTime");

    if (isCronDefaultRun) {
      // Originally gated on a narrow local-time window (23:55-00:04) to let
      // exactly one of vercel.json's two DST-safe firings (04:59/05:59 UTC)
      // through per night. That assumed Vercel invokes crons at the exact
      // scheduled minute -- false on Hobby, which documents up to a 1-hour
      // flexible window per firing. Confirmed empirically: no sync_timestamp
      // was written at all the night this was caught, meaning both firings'
      // actual (jittered) invocation times missed the 9-minute window every
      // single night, not just occasionally.
      //
      // Gate on calendar date instead -- immune to jitter of any size within
      // the day, and still prevents double-syncing: whichever firing (or a
      // manual "Run") lands first each local day performs the sync; the
      // other sees today's date already covered and no-ops. A bonus over the
      // old design: if the first firing fails before writing anything,
      // sync_timestamp stays on yesterday's date, so the second firing later
      // that day retries instead of silently staying skipped for 24h.
      const { data: orgRow } = await supabase
        .from("organizations")
        .select("id, timezone")
        .eq("mindbody_site_id", configuredSiteId)
        .maybeSingle();

      if (orgRow?.timezone) {
        const localToday = DateTime.utc().setZone(orgRow.timezone).toISODate();

        const { data: lastSync } = await supabase
          .from("class_occurrences")
          .select("sync_timestamp")
          .eq("organization_id", orgRow.id)
          .order("sync_timestamp", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        const lastSyncLocalDate = lastSync?.sync_timestamp
          ? DateTime.fromISO(lastSync.sync_timestamp, { zone: "utc" }).setZone(orgRow.timezone).toISODate()
          : null;

        if (lastSyncLocalDate === localToday) {
          return NextResponse.json({
            success: true,
            skipped: true,
            reason: `Already synced today (local date ${localToday} in ${orgRow.timezone}).`,
          });
        }
      }
      // No org row yet (first-ever run) -- proceed unconditionally rather
      // than blocking bootstrap on a gate that has nothing to check against.
    }

    // The nightly cron hits this route with no query params at all -- default
    // to a 2-day lookback so TotalSignedIn (which MindBody fills in
    // progressively as check-ins happen, unlike TotalBooked) is re-pulled
    // for anything that occurred since the last run, with one extra day of
    // slack in case a prior night's run failed silently.
    const startDateTime =
      searchParams.get("startDateTime") ?? DateTime.utc().minus({ days: 2 }).toISO();
    const endDateTime = searchParams.get("endDateTime") ?? DateTime.utc().toISO();
    const locationIdParam = searchParams.get("locationId");
    const locationId = locationIdParam ? Number(locationIdParam) : undefined;
    // Captured once per run, not per row -- every occurrence written by this
    // sync shares one timestamp, so it answers "when did the run that wrote
    // this happen" rather than drifting across the seconds a large sync takes.
    const syncedAt = DateTime.utc().toISO();

    // Site resolution stays Authorization-free -- Api-Key + SiteId alone is
    // the activated-key production model, and this is the one call that
    // must never depend on a staff token's own scoping. Confirmed
    // empirically (see conversation history): with the current, fully
    // activated credentials, /site/sites returns the same unfiltered set of
    // every site this Api-Key can access whether or not a staff token is
    // included -- but keeping this call token-free entirely means site
    // identity can never regress to depending on which staff member's
    // token happens to be in hand.
    //
    // MindBody exposes one IANA timezone per site (GET /site/sites), not per
    // Location. Resolve it once per sync run and use it to interpret every
    // class's naive local StartDateTime -- guessing a fixed timezone here
    // would silently corrupt data for any studio not in that timezone.
    //
    // /site/sites returns every site this Api-Key has activated access to,
    // not just one -- confirmed empirically (it returned both the sandbox
    // demo site AND the real production site for this key). Must match by
    // the configured MINDBODY_SITE_ID, not blindly take the first result.
    const siteResult = await mindbody.getSite();
    const site = siteResult.Sites?.find((candidate: { Id: number }) => candidate.Id === configuredSiteId);

    if (!site) {
      throw new Error(
        `MindBody /site/sites did not return a site matching MINDBODY_SITE_ID=${configuredSiteId}.`,
      );
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
    const locationIdByMindbodyId = await syncLocations(mindbody, supabase, org.id, org.timezone);
    const roomIdByResourceId = await syncRooms(mindbody, supabase, org.id);
    const departmentIdByProgramId = await syncDepartments(mindbody, supabase, org.id);
    const staffIdByMindbodyId = await syncStaff(mindbody, supabase, org.id);

    // Neither /site/resources nor any other site-wide endpoint tells us which
    // location a room belongs to -- the only place that link appears is on a
    // class occurrence itself (Resource + Location together). Accumulated here
    // as classes are paged through below and applied once the loop finishes,
    // rather than one write per class -- see 20260721140000's migration
    // comment for how this was derived and validated (rooms are cleanly
    // 1:1 with a location; departments are not, which is why departments took
    // a direct organization_id column instead).
    const roomLocationUpdates = new Map<string, string>();

    // Class capacity/booking fields (MaxCapacity, TotalBooked, TotalSignedIn)
    // are masked by design on a plain Api-Key + SiteId request -- confirmed
    // by MindBody support, a site-level setting, not a bug. Seeing real
    // values requires a staff User Token in the Authorization header
    // alongside Api-Key + SiteId. Fetched here, used ONLY for the
    // getClasses call below -- never for getSite/site resolution above,
    // which is the actual safeguard against a repeat of the earlier bug
    // (see that comment). Confirmed empirically before wiring this in: with
    // MINDBODY_USERNAME/PASSWORD now genuinely Preserve-homed credentials
    // (subscriberId 561843 in the token's own JWT payload, not sandbox),
    // including this token does not change which site's data comes back.
    //
    // Soft-fail, not fatal: if the staff login itself fails (expired
    // password, revoked account, transient MindBody hiccup), the sync
    // should still import real class/schedule data with capacity fields
    // simply staying null/0, rather than the whole sync failing outright
    // over an enhancement that isn't required for the sync's core purpose.
    let capacityAccessToken: string | undefined;
    try {
      const capacityAuth = await mindbody.authenticate();
      capacityAccessToken = capacityAuth.AccessToken;
    } catch (authError) {
      console.error("Failed to fetch a capacity-visibility user token -- continuing without it:", authError);
    }

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
        mindbody.getClasses(capacityAccessToken, {
          startDateTime,
          endDateTime,
          locationId,
          offset,
          limit: pageLimit,
        }),
      );
      const classes = page.Classes ?? [];
      // Only trust TotalResults from a page that actually returned rows --
      // confirmed empirically against /sale/sales (same pagination shape as
      // this endpoint): the true terminal empty page reports
      // TotalResults: 0 even though every prior page agreed on a higher
      // (and it turns out overstated) figure. Skipping the empty page's
      // TotalResults keeps totalClasses at the last real value instead of
      // being clobbered to 0 right as the loop is about to exit anyway.
      if (classes.length > 0) {
        totalClasses = page.PaginationResponse?.TotalResults ?? totalClasses;
      }

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
              sync_timestamp: syncedAt,

              staff_id: cls.Staff?.Id != null ? staffIdByMindbodyId.get(cls.Staff.Id) ?? null : null,
              department_id:
                cls.ClassDescription?.Program?.Id != null
                  ? departmentIdByProgramId.get(cls.ClassDescription.Program.Id) ?? null
                  : null,
              room_id: cls.Resource?.Id != null ? roomIdByResourceId.get(cls.Resource.Id) ?? null : null,
              substitute_staff_id: null,
            },
            {
              onConflict: "organization_id,mindbody_occurrence_id",
            },
          );

        if (!error) {
          imported++;
        } else {
          console.error(error);
        }

        const roomId = cls.Resource?.Id != null ? roomIdByResourceId.get(cls.Resource.Id) : null;
        const locationId = cls.Location?.Id != null ? locationIdByMindbodyId.get(cls.Location.Id) : null;
        if (roomId && locationId) {
          roomLocationUpdates.set(roomId, locationId);
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

    // One update per distinct room seen this run (a handful of rows), not
    // one per class -- rooms rarely change location, so this just keeps
    // rooms.location_id self-healing on every future sync instead of relying
    // on a one-time backfill staying correct forever.
    for (const [roomId, locationId] of roomLocationUpdates) {
      const { error: roomLocationError } = await supabase
        .from("rooms")
        .update({ location_id: locationId })
        .eq("id", roomId);

      if (roomLocationError) {
        console.error(roomLocationError);
      }
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
