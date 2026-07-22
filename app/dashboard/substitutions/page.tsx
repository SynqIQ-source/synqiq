import { DateTime } from "luxon";
import { CurrentUserBanner } from "@/components/current-user-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { StaffSelect } from "@/components/staff-select";
import { getCurrentStaff, resolveViewedStaffId } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { getActiveStaff } from "@/lib/staff";
import { CandidatesButton } from "./candidates-button";
import { RequestNewSubButton } from "./request-new-sub-button";

type SubstitutionRequestRow = {
  id: string;
  status: "open" | "approved";
  reason: string | null;
  created_at: string;
  requestedByStaff: { display_name: string } | null;
  occurrence: {
    id: string;
    class_name: string | null;
    start_datetime: string | null;
    substitute_staff_id: string | null;
    substituteStaff: { display_name: string } | null;
    room: { name: string | null } | null;
    organization: { timezone: string | null } | null;
  } | null;
};

async function getActiveSubstitutionRequests(supabase: ScopedSupabaseClient) {
  // The full active pipeline a manager needs to see: 'open' (needs
  // candidates reviewed) and 'approved' (a substitute is arranged) --
  // scoped to classes that haven't happened yet. !inner on the occurrence
  // embed is required for the start_datetime filter below to actually
  // restrict which substitution_requests rows come back, not just which
  // fields are embedded.
  const { data, error } = await supabase
    .from("substitution_requests")
    .select(
      `
      id,
      status,
      reason,
      created_at,
      requestedByStaff:staff!substitution_requests_requested_by_fkey ( display_name ),
      occurrence:class_occurrences!substitution_requests_occurrence_id_fkey!inner (
        id,
        class_name,
        start_datetime,
        substitute_staff_id,
        substituteStaff:staff!class_occurrences_substitute_staff_id_fkey ( display_name ),
        room:rooms!class_occurrences_room_id_fkey ( name ),
        organization:organizations!class_occurrences_organization_id_fkey ( timezone )
      )
      `,
    )
    .in("status", ["open", "approved"])
    .gt("occurrence.start_datetime", DateTime.utc().toISO())
    .order("created_at", { ascending: true })
    .returns<SubstitutionRequestRow[]>();

  if (error) {
    throw new Error(`Failed to load substitution requests: ${error.message}`);
  }

  return data ?? [];
}

function formatStartTime(startDatetime: string | null, timezone: string | null) {
  if (!startDatetime) {
    return "N/A";
  }

  return DateTime.fromISO(startDatetime, { zone: "utc" })
    .setZone(timezone ?? "utc")
    .toFormat("EEE, MMM d 'at' h:mm a ZZZZ");
}

export default async function SubstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<{ staffId?: string }>;
}) {
  const params = await searchParams;
  const currentStaff = await getCurrentStaff();
  const callerStaffId = await resolveViewedStaffId(currentStaff, params.staffId ?? null);

  // Adam's real session -> RLS-scoped client, so the
  // substitution_requests_select_same_org policy is the actual
  // enforcement. Everyone else (dropdown, no session yet) -> the admin
  // client, same as before -- RLS has no way to authorize a session-less
  // caller, so this preserves current behavior rather than locking them out.
  const supabase = await getScopedClient(currentStaff);

  const staffOptions = await getActiveStaff();
  const requests = await getActiveSubstitutionRequests(supabase);

  return (
    <DashboardShell
      title="Substitutions"
      description="Open and upcoming coverage requests."
    >
      {currentStaff ? (
        <CurrentUserBanner
          displayName={currentStaff.displayName}
          role={currentStaff.role}
        />
      ) : (
        <StaffSelect staffOptions={staffOptions} staffId={callerStaffId} />
      )}

      <p className="mt-2 text-xs text-zinc-500">
        Select your name to cancel or re-request coverage -- both actions
        currently check that you&apos;re the original requester (no admin
        override exists yet without real auth/roles).
      </p>

      {requests.length === 0 ? (
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-6">
          <h2 className="text-base font-semibold text-zinc-950">
            Nothing active right now
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            No open or upcoming approved substitution requests.
          </p>
        </section>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-left">Class</th>
                <th className="p-3 text-left">Date/Time</th>
                <th className="p-3 text-left">Room</th>
                <th className="p-3 text-left">Requested By</th>
                <th className="p-3 text-left">Reason</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const className = request.occurrence?.class_name ?? "Unknown class";
                const startFormatted = formatStartTime(
                  request.occurrence?.start_datetime ?? null,
                  request.occurrence?.organization?.timezone ?? null,
                );
                const roomName = request.occurrence?.room?.name ?? "Not assigned";
                const requestedByName =
                  request.requestedByStaff?.display_name ?? "Unknown";

                return (
                  <tr key={request.id} className="border-b align-top">
                    <td className="p-3">{className}</td>
                    <td className="p-3">{startFormatted}</td>
                    <td className="p-3">{roomName}</td>
                    <td className="p-3">{requestedByName}</td>
                    <td className="max-w-xs p-3 text-zinc-600">
                      {request.reason ?? "—"}
                    </td>
                    <td className="p-3">
                      {request.status === "approved" ? (
                        <span className="inline-flex items-center rounded-full bg-accent-subtle px-2 py-1 text-xs font-medium text-accent">
                          Approved — {request.occurrence?.substituteStaff?.display_name ?? "Unknown"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                          Open
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {request.status === "approved" ? (
                        <RequestNewSubButton
                          occurrenceId={request.occurrence?.id ?? ""}
                          className={className}
                          startFormatted={startFormatted}
                          roomName={roomName}
                          requestedBy={callerStaffId}
                        />
                      ) : (
                        <CandidatesButton
                          requestId={request.id}
                          className={className}
                          startFormatted={startFormatted}
                          roomName={roomName}
                          requestedByName={requestedByName}
                          callerStaffId={callerStaffId}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
