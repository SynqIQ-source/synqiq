import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CandidatesButton } from "./candidates-button";

type OpenRequestRow = {
  id: string;
  reason: string | null;
  created_at: string;
  requestedByStaff: { display_name: string } | null;
  occurrence: {
    id: string;
    class_name: string | null;
    start_datetime: string | null;
    room: { name: string | null } | null;
    organization: { timezone: string | null } | null;
  } | null;
};

async function getOpenSubstitutionRequests() {
  // Same RLS caveat as every other dashboard page (app/dashboard/classes/page.tsx
  // has the full explanation): service-role client, fine for a single-org sandbox.
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("substitution_requests")
    .select(
      `
      id,
      reason,
      created_at,
      requestedByStaff:staff!substitution_requests_requested_by_fkey ( display_name ),
      occurrence:class_occurrences!substitution_requests_occurrence_id_fkey (
        id,
        class_name,
        start_datetime,
        room:rooms!class_occurrences_room_id_fkey ( name ),
        organization:organizations!class_occurrences_organization_id_fkey ( timezone )
      )
      `,
    )
    // Only requests still awaiting a decision belong on this board --
    // pending_selection/approved/completed/cancelled are resolved.
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .returns<OpenRequestRow[]>();

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

export default async function SubstitutionsPage() {
  const requests = await getOpenSubstitutionRequests();

  return (
    <DashboardShell
      title="Substitutions"
      description="Open coverage requests awaiting a manager decision."
    >
      {requests.length === 0 ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-6">
          <h2 className="text-base font-semibold text-zinc-950">
            No open requests
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Every substitution request has been resolved.
          </p>
        </section>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-left">Class</th>
                <th className="p-3 text-left">Date/Time</th>
                <th className="p-3 text-left">Room</th>
                <th className="p-3 text-left">Requested By</th>
                <th className="p-3 text-left">Reason</th>
                <th className="p-3 text-right">Candidates</th>
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
                    <td className="p-3 text-right">
                      <CandidatesButton
                        requestId={request.id}
                        className={className}
                        startFormatted={startFormatted}
                        roomName={roomName}
                        requestedByName={requestedByName}
                      />
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
