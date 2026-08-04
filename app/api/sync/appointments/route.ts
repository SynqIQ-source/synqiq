import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { delay, withRetry } from "@/lib/retry";
import type { MindbodyAppointment } from "@/types/mindbody";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

// Staff and Locations are synced by /api/sync/classes, not here -- this
// route just looks up the ids that sync already produced. Reads the whole
// org roster/location list once per run rather than one query per
// appointment (a handful of rows, same as syncLocations/syncStaff in the
// classes route).
async function getStaffIdByMindbodyId(supabase: SupabaseAdminClient, organizationId: string) {
  const { data, error } = await supabase
    .from("staff")
    .select("id, mindbody_staff_id")
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(`Failed to load staff: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.mindbody_staff_id as number, row.id as string]));
}

async function getLocationIdByMindbodyId(supabase: SupabaseAdminClient, organizationId: string) {
  const { data, error } = await supabase
    .from("Locations")
    .select("id, mindbody_location_id")
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(`Failed to load locations: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.mindbody_location_id as number, row.id as string]));
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;

    const mindbody = createMindbodyClient();
    const supabase = createSupabaseAdminClient();

    const { AccessToken: accessToken } = await mindbody.authenticate();

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

    const staffIdByMindbodyId = await getStaffIdByMindbodyId(supabase, org.id);
    const locationIdByMindbodyId = await getLocationIdByMindbodyId(supabase, org.id);

    let imported = 0;
    let total = 0;
    let offset = 0;
    const pageLimit = 200;

    for (;;) {
      const page = await withRetry(() =>
        mindbody.getStaffAppointments(accessToken, { startDate, endDate, offset, limit: pageLimit }),
      );
      const appointments = (page.Appointments ?? []) as MindbodyAppointment[];
      // Only trust TotalResults from a page that actually returned rows --
      // confirmed empirically against the sandbox's /sale/sales endpoint
      // (same pagination shape as this one): the true terminal empty page
      // reports TotalResults: 0 even when every prior page agreed on a
      // higher (and it turns out overstated) figure. Skipping the empty
      // page's TotalResults keeps `total` at the last real value instead of
      // being clobbered to 0 right as the loop is about to exit anyway.
      if (appointments.length > 0) {
        total = page.PaginationResponse?.TotalResults ?? total;
      }

      for (const appointment of appointments) {
        // Same naive-local-time shape as class occurrences' StartDateTime --
        // confirmed empirically (no timezone offset in the raw string) --
        // interpreted against the site's own timezone, not assumed UTC.
        const startDatetime = DateTime.fromISO(appointment.StartDateTime, { zone: org.timezone })
          .toUTC()
          .toISO();
        const endDatetime = appointment.EndDateTime
          ? DateTime.fromISO(appointment.EndDateTime, { zone: org.timezone }).toUTC().toISO()
          : null;

        const { error } = await supabase.from("appointment_occurrences").upsert(
          {
            mindbody_appointment_id: appointment.Id,
            organization_id: org.id,
            staff_id: staffIdByMindbodyId.get(appointment.StaffId) ?? null,
            location_id:
              appointment.LocationId != null ? locationIdByMindbodyId.get(appointment.LocationId) ?? null : null,
            client_id: appointment.ClientId,
            session_type_id: appointment.SessionTypeId,
            status: appointment.Status,
            start_datetime: startDatetime,
            end_datetime: endDatetime,
            duration_minutes: appointment.Duration,
          },
          { onConflict: "mindbody_appointment_id" },
        );

        if (!error) {
          imported++;
        } else {
          console.error(error);
        }
      }

      offset += appointments.length;
      if (appointments.length === 0 || offset >= total) {
        break;
      }

      await delay(300);
    }

    return NextResponse.json({ success: true, imported, total });
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
