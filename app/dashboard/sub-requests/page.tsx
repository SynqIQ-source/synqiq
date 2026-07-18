import { DateTime } from "luxon";
import { CurrentUserBanner } from "@/components/current-user-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { StaffSelect } from "@/components/staff-select";
import { getCurrentStaff, resolveViewedStaffId } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { formatClassTime } from "@/lib/format-class-time";
import { getActiveStaff } from "@/lib/staff";
import { CancelRequestButton } from "./cancel-request-button";
import { ResponseButtons, type ResponseStatus } from "./response-buttons";

type MyRequestRow = {
  id: string;
  status: "open" | "pending_selection" | "approved";
  occurrence: {
    id: string;
    class_name: string | null;
    start_datetime: string | null;
    end_datetime: string | null;
    substitute_staff_id: string | null;
    substituteStaff: { display_name: string } | null;
    room: { name: string | null } | null;
    organization: { timezone: string | null } | null;
  } | null;
};

async function getMyRequests(supabase: ScopedSupabaseClient, staffId: string) {
  const { data, error } = await supabase
    .from("substitution_requests")
    .select(
      `
      id,
      status,
      occurrence:class_occurrences!substitution_requests_occurrence_id_fkey (
        id,
        class_name,
        start_datetime,
        end_datetime,
        substitute_staff_id,
        substituteStaff:staff!class_occurrences_substitute_staff_id_fkey ( display_name ),
        room:rooms!class_occurrences_room_id_fkey ( name ),
        organization:organizations!class_occurrences_organization_id_fkey ( timezone )
      )
      `,
    )
    .eq("requested_by", staffId)
    .in("status", ["open", "pending_selection", "approved"])
    .order("created_at", { ascending: true })
    .returns<MyRequestRow[]>();

  if (error) {
    throw new Error(`Failed to load your requests: ${error.message}`);
  }

  return data ?? [];
}

type OpenRequestRow = {
  id: string;
  created_at: string;
  requestedByStaff: { display_name: string } | null;
  occurrence: {
    id: string;
    class_name: string | null;
    start_datetime: string | null;
    end_datetime: string | null;
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

async function getOpenRequestsQualifiedFor(
  supabase: ScopedSupabaseClient,
  staffId: string,
) {
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
        end_datetime,
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
  // since this is a server component with its own scoped Supabase access
  // rather than making the page fetch its own API route.
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

function formatDateLabel(startDatetime: string | null, timezone: string | null) {
  if (!startDatetime) {
    return null;
  }

  return DateTime.fromISO(startDatetime, { zone: "utc" })
    .setZone(timezone ?? "utc")
    .toFormat("EEE, MMM d");
}

export default async function SubRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ staffId?: string }>;
}) {
  const params = await searchParams;
  const currentStaff = await getCurrentStaff();
  const staffId = await resolveViewedStaffId(currentStaff, params.staffId ?? null);

  // Adam's real session -> RLS-scoped client, so the same-org select
  // policies on substitution_requests/instructor_class_eligibility/
  // substitution_interests are the actual enforcement. Everyone else
  // (dropdown, no session yet) -> the admin client, same as before.
  const supabase = await getScopedClient(currentStaff);

  const staffOptions = await getActiveStaff();
  const rows = staffId ? await getOpenRequestsQualifiedFor(supabase, staffId) : [];
  const myRequests = staffId ? await getMyRequests(supabase, staffId) : [];

  return (
    <DashboardShell
      title="Sub Requests"
      description="Your own coverage requests, and open requests you're qualified to cover."
    >
      {currentStaff ? (
        <CurrentUserBanner
          displayName={currentStaff.displayName}
          role={currentStaff.role}
        />
      ) : (
        <StaffSelect staffOptions={staffOptions} staffId={staffId} />
      )}

      {staffId ? (
        <div className="mt-6">
          <h2 className="text-base font-semibold text-zinc-950">
            My Requests
          </h2>
          {myRequests.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              You have no open substitution requests.
            </p>
          ) : (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myRequests.map((request) => {
                const occurrence = request.occurrence;
                const className = occurrence?.class_name ?? "Unknown class";
                const dateLabel = formatDateLabel(
                  occurrence?.start_datetime ?? null,
                  occurrence?.organization?.timezone ?? null,
                );
                const timeRange = formatClassTime(
                  occurrence?.start_datetime ?? null,
                  occurrence?.end_datetime ?? null,
                  occurrence?.organization?.timezone ?? null,
                );
                const timeFormatted = dateLabel
                  ? `${dateLabel}, ${timeRange}`
                  : timeRange;
                const roomName = occurrence?.room?.name ?? "Not assigned";

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
                            {timeFormatted}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-zinc-500">Room</dt>
                          <dd className="text-right text-zinc-950">
                            {roomName}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="mt-5">
                      {request.status === "approved" ? (
                        <span className="inline-flex items-center rounded-full bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700">
                          Approved — {occurrence?.substituteStaff?.display_name ?? "Unknown"}
                        </span>
                      ) : request.status === "open" ? (
                        <CancelRequestButton
                          requestId={request.id}
                          callerStaffId={staffId}
                        />
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
                          Pending selection
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-8">
        <h2 className="text-base font-semibold text-zinc-950">
          Requests You Can Cover
        </h2>
        {!staffId ? (
          <section className="mt-3 rounded-lg border border-zinc-200 bg-white p-6">
            <h3 className="text-base font-semibold text-zinc-950">
              Select your name
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Choose your name above to see open requests you&apos;re
              qualified to cover.
            </p>
          </section>
        ) : rows.length === 0 ? (
          <section className="mt-3 rounded-lg border border-zinc-200 bg-white p-6">
            <h3 className="text-base font-semibold text-zinc-950">
              Nothing to cover right now
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              No open requests currently match your class eligibility.
            </p>
          </section>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ request, myStatus }) => {
              const occurrence = request.occurrence;
              const className = occurrence?.class_name ?? "Unknown class";
              const dateLabel = formatDateLabel(
                occurrence?.start_datetime ?? null,
                occurrence?.organization?.timezone ?? null,
              );
              const timeRange = formatClassTime(
                occurrence?.start_datetime ?? null,
                occurrence?.end_datetime ?? null,
                occurrence?.organization?.timezone ?? null,
              );
              const timeFormatted = dateLabel
                ? `${dateLabel}, ${timeRange}`
                : timeRange;
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
                          {timeFormatted}
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
