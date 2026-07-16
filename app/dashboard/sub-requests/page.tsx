import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { StaffSelect } from "@/components/staff-select";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getActiveStaff } from "@/lib/staff";
import { ResponseButtons, type ResponseStatus } from "./response-buttons";

type OpenRequestRow = {
  id: string;
  created_at: string;
  requestedByStaff: { display_name: string } | null;
  occurrence: {
    id: string;
    class_name: string | null;
    start_datetime: string | null;
    staff_id: string | null;
    department_id: string | null;
    room: { name: string | null } | null;
    organization: { timezone: string | null } | null;
  } | null;
};

type EligibilityRow = {
  department_id: string;
  class_name: string;
};

async function getOpenRequestsQualifiedFor(staffId: string) {
  const supabase = createSupabaseAdminClient();

  // Same eligibility rule used at request-creation time
  // (app/api/substitution-requests/route.ts): a row in
  // instructor_class_eligibility for this staff member's (department, class
  // name) combo, enabled=true. Absence of a row means not eligible.
  const { data: eligibilityRows, error: eligibilityError } = await supabase
    .from("instructor_class_eligibility")
    .select("department_id, class_name")
    .eq("staff_id", staffId)
    .eq("enabled", true)
    .returns<EligibilityRow[]>();

  if (eligibilityError) {
    throw new Error(`Failed to load eligibility: ${eligibilityError.message}`);
  }

  const eligibleCombos = new Set(
    (eligibilityRows ?? []).map((row) => `${row.department_id}::${row.class_name}`),
  );

  const { data: requests, error: requestsError } = await supabase
    .from("substitution_requests")
    .select(
      `
      id,
      created_at,
      requestedByStaff:staff!substitution_requests_requested_by_fkey ( display_name ),
      occurrence:class_occurrences!substitution_requests_occurrence_id_fkey (
        id,
        class_name,
        start_datetime,
        staff_id,
        department_id,
        room:rooms!class_occurrences_room_id_fkey ( name ),
        organization:organizations!class_occurrences_organization_id_fkey ( timezone )
      )
      `,
    )
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .returns<OpenRequestRow[]>();

  if (requestsError) {
    throw new Error(`Failed to load substitution requests: ${requestsError.message}`);
  }

  const qualifying = (requests ?? []).filter((request) => {
    const occurrence = request.occurrence;

    if (!occurrence || !occurrence.department_id || !occurrence.class_name) {
      return false;
    }

    // Can't cover your own class.
    if (occurrence.staff_id === staffId) {
      return false;
    }

    const key = `${occurrence.department_id}::${occurrence.class_name.trim()}`;
    return eligibleCombos.has(key);
  });

  // Batch-load this staff member's own response to each qualifying request --
  // same underlying data as GET .../interest/mine, queried directly here
  // since this is a server component with its own admin-client access
  // (the same convention every other dashboard page follows) rather than
  // making the page fetch its own API route.
  const myResponses = new Map<string, ResponseStatus>();
  const requestIds = qualifying.map((request) => request.id);

  if (requestIds.length > 0) {
    const { data: interestRows, error: interestError } = await supabase
      .from("substitution_interests")
      .select("request_id, status")
      .eq("staff_id", staffId)
      .in("request_id", requestIds);

    if (interestError) {
      throw new Error(`Failed to load responses: ${interestError.message}`);
    }

    for (const row of interestRows ?? []) {
      myResponses.set(row.request_id, row.status as ResponseStatus);
    }
  }

  return qualifying.map((request) => ({
    request,
    myStatus: myResponses.get(request.id) ?? null,
  }));
}

function formatStartTime(startDatetime: string | null, timezone: string | null) {
  if (!startDatetime) {
    return "N/A";
  }

  return DateTime.fromISO(startDatetime, { zone: "utc" })
    .setZone(timezone ?? "utc")
    .toFormat("EEE, MMM d 'at' h:mm a ZZZZ");
}

export default async function SubRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ staffId?: string }>;
}) {
  const params = await searchParams;
  const staffId = params.staffId ?? null;

  const staffOptions = await getActiveStaff();
  const rows = staffId ? await getOpenRequestsQualifiedFor(staffId) : [];

  return (
    <DashboardShell
      title="Sub Requests"
      description="Open coverage requests you're qualified to cover."
    >
      <StaffSelect staffOptions={staffOptions} staffId={staffId} />

      <div className="mt-6">
        {!staffId ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-base font-semibold text-zinc-950">
              Select your name
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Choose your name above to see open requests you&apos;re
              qualified to cover.
            </p>
          </section>
        ) : rows.length === 0 ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-base font-semibold text-zinc-950">
              Nothing to cover right now
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              No open requests currently match your class eligibility.
            </p>
          </section>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ request, myStatus }) => {
              const occurrence = request.occurrence;
              const className = occurrence?.class_name ?? "Unknown class";
              const startFormatted = formatStartTime(
                occurrence?.start_datetime ?? null,
                occurrence?.organization?.timezone ?? null,
              );
              const roomName = occurrence?.room?.name ?? "Not assigned";
              const requestedByName =
                request.requestedByStaff?.display_name ?? "Unknown";

              return (
                <div
                  key={request.id}
                  className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-white p-5"
                >
                  <div>
                    <h3 className="text-base font-semibold text-zinc-950">
                      {className}
                    </h3>
                    <dl className="mt-3 space-y-1 text-sm text-zinc-600">
                      <div className="flex justify-between gap-4">
                        <dt className="text-zinc-500">Time</dt>
                        <dd className="text-right text-zinc-950">
                          {startFormatted}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-zinc-500">Room</dt>
                        <dd className="text-right text-zinc-950">
                          {roomName}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-zinc-500">Needs coverage for</dt>
                        <dd className="text-right text-zinc-950">
                          {requestedByName}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="mt-5">
                    <ResponseButtons
                      requestId={request.id}
                      staffId={staffId}
                      initialStatus={myStatus}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
