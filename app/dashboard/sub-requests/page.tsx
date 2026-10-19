import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { CheckCircle2, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StaffNotProvisioned } from "@/components/staff-not-provisioned";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { formatClassTime } from "@/lib/format-class-time";
import { getExcludedDepartmentIds } from "@/lib/excluded-departments";
import { CancelRequestButton } from "./cancel-request-button";
import { ResponseButtons, type ResponseStatus } from "./response-buttons";

const TITLE = "Sub Requests";
const DESCRIPTION = "Your own coverage requests, and open requests you're qualified to cover.";

type MyRequestRow = {
  id: string;
  status: "open" | "pending_selection" | "approved";
  occurrence: {
    id: string;
    class_name: string | null;
    start_datetime: string | null;
    end_datetime: string | null;
    substitute_staff_id: string | null;
    department_id: string | null;
    substituteStaff: { display_name: string } | null;
    room: { name: string | null } | null;
    organization: { timezone: string | null } | null;
  } | null;
};

async function getMyRequests(supabase: ScopedSupabaseClient, staffId: string, hiddenDepartmentIds: Set<string>) {
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
        department_id,
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

  // Pool Lanes doesn't use the substitution system -- see
  // lib/excluded-departments.ts. New requests are already blocked at
  // creation; this only matters for any pre-existing row.
  return (data ?? []).filter(
    (row) => !row.occurrence?.department_id || !hiddenDepartmentIds.has(row.occurrence.department_id),
  );
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
  hiddenDepartmentIds: Set<string>,
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

    // Pool Lanes doesn't use the substitution system -- see
    // lib/excluded-departments.ts. New requests are already blocked at
    // creation; this only matters for any pre-existing row.
    if (hiddenDepartmentIds.has(occurrence.department_id)) {
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

export default async function SubRequestsPage() {
  // middleware.ts already guarantees a real Supabase Auth session for
  // anything under /dashboard/* -- currentStaff can still be null here in
  // one narrow case (a valid session with no linked staff row), handled
  // below, not the old dropdown-mode fallback.
  const currentStaff = await getCurrentStaff();

  if (!currentStaff) {
    return (
      <DashboardShell title={TITLE} description={DESCRIPTION}>
        <StaffNotProvisioned />
      </DashboardShell>
    );
  }

  const staffId = currentStaff.id;
  const supabase = await getScopedClient(currentStaff);
  const hiddenDepartmentIds = await getExcludedDepartmentIds(supabase);

  const rows = await getOpenRequestsQualifiedFor(supabase, staffId, hiddenDepartmentIds);
  const myRequests = await getMyRequests(supabase, staffId, hiddenDepartmentIds);

  return (
    <DashboardShell title={TITLE} description={DESCRIPTION}>
      <Tabs defaultValue={rows.length === 0 && myRequests.length > 0 ? "mine" : "cover"} className="gap-4">
        <TabsList>
          <TabsTrigger value="cover">
            You can cover
            <CountPill count={rows.length} />
          </TabsTrigger>
          <TabsTrigger value="mine">
            My requests
            <CountPill count={myRequests.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cover" className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyCard
              title="Nothing to cover right now"
              text="When a class you're eligible to teach needs a sub, it shows up here."
            />
          ) : (
            rows.map(({ request, myStatus }) => {
              const occurrence = request.occurrence;
              const timezone = occurrence?.organization?.timezone ?? null;
              return (
                <RequestRow
                  key={request.id}
                  startDatetime={occurrence?.start_datetime ?? null}
                  timezone={timezone}
                  className={occurrence?.class_name?.trim() || "Unknown class"}
                  timeRange={formatClassTime(occurrence?.start_datetime ?? null, occurrence?.end_datetime ?? null, timezone)}
                  roomName={occurrence?.room?.name ?? "No room"}
                  detail={`For ${request.requestedByStaff?.display_name ?? "Unknown"}`}
                  action={<ResponseButtons requestId={request.id} initialStatus={myStatus} />}
                />
              );
            })
          )}
        </TabsContent>

        <TabsContent value="mine" className="flex flex-col gap-3">
          {myRequests.length === 0 ? (
            <EmptyCard
              title="No open requests"
              text="Need someone to cover a class? Request a sub from My Schedule."
            />
          ) : (
            myRequests.map((request) => {
              const occurrence = request.occurrence;
              const timezone = occurrence?.organization?.timezone ?? null;
              return (
                <RequestRow
                  key={request.id}
                  startDatetime={occurrence?.start_datetime ?? null}
                  timezone={timezone}
                  className={occurrence?.class_name?.trim() || "Unknown class"}
                  timeRange={formatClassTime(occurrence?.start_datetime ?? null, occurrence?.end_datetime ?? null, timezone)}
                  roomName={occurrence?.room?.name ?? "No room"}
                  action={
                    request.status === "approved" ? (
                      <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                        <CheckCircle2 />
                        Covered by {occurrence?.substituteStaff?.display_name ?? "Unknown"}
                      </Badge>
                    ) : request.status === "open" ? (
                      <div className="flex flex-col items-stretch gap-2 sm:items-end">
                        <Badge variant="outline">
                          <Clock3 />
                          Waiting for volunteers
                        </Badge>
                        <CancelRequestButton requestId={request.id} />
                      </div>
                    ) : (
                      <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">
                        <Clock3 />
                        Manager choosing a sub
                      </Badge>
                    )
                  }
                />
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
}

function CountPill({ count }: { count: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
      {count}
    </span>
  );
}

function EmptyCard({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-1 py-10 text-center">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

function RequestRow({
  startDatetime,
  timezone,
  className,
  timeRange,
  roomName,
  detail,
  action,
}: {
  startDatetime: string | null;
  timezone: string | null;
  className: string;
  timeRange: string;
  roomName: string;
  detail?: string;
  action: React.ReactNode;
}) {
  const start = startDatetime ? DateTime.fromISO(startDatetime, { zone: "utc" }).setZone(timezone ?? "utc") : null;

  return (
    <Card className="py-0">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-primary-subtle text-primary">
          <span className="text-[11px] font-semibold uppercase">{start ? start.toFormat("ccc") : "—"}</span>
          <span className="text-lg leading-none font-semibold tabular-nums">{start ? start.toFormat("d") : ""}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{className}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {start ? `${start.toFormat("LLL d")} · ` : ""}
            {timeRange} · {roomName}
          </p>
          {detail ? <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p> : null}
        </div>
        <div className="sm:max-w-[280px]">{action}</div>
      </div>
    </Card>
  );
}
