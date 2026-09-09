import { DateTime } from "luxon";
import { CurrentUserBanner } from "@/components/current-user-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { StaffNotProvisioned } from "@/components/staff-not-provisioned";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { FollowUpComposer } from "./follow-up-composer";

const TITLE = "Follow Up";
const DESCRIPTION =
  "Reach out to members who recently checked in to one of your classes. They see your name and the studio -- your email address stays private.";

// How far back a check-in still shows up here as a follow-up prospect.
const ROSTER_WINDOW_DAYS = 45;

type OccurrenceRow = {
  id: string;
  class_name: string | null;
  start_datetime: string | null;
};

type ClientRow = {
  id: string;
  mindbody_unique_id: number;
  first_name: string;
  last_name: string;
  email: string | null;
};

type Prospect = {
  clientId: string;
  name: string;
  lastClassName: string;
  lastClassAt: string | null;
  conversationId: string | null;
};

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  const { data } = await supabase.from("organizations").select("timezone").limit(1).maybeSingle();
  return data?.timezone ?? "utc";
}

export default async function FollowUpPage() {
  const currentStaff = await getCurrentStaff();

  if (!currentStaff) {
    return (
      <DashboardShell title={TITLE} description={DESCRIPTION}>
        <StaffNotProvisioned />
      </DashboardShell>
    );
  }

  const supabase = await getScopedClient(currentStaff);
  const timezone = await getOrgTimezone(supabase);
  const now = DateTime.now().setZone(timezone);
  const windowStartIso = now.minus({ days: ROSTER_WINDOW_DAYS }).toUTC().toISO() ?? "";
  const nowIso = now.toUTC().toISO() ?? "";

  // This instructor's own past classes (plus any they covered as a sub),
  // most recent first.
  const { data: occurrenceData, error: occurrenceError } = await supabase
    .from("class_occurrences")
    .select("id, class_name, start_datetime")
    .or(`staff_id.eq.${currentStaff.id},substitute_staff_id.eq.${currentStaff.id}`)
    .not("mindbody_occurrence_id", "is", null)
    .gte("start_datetime", windowStartIso)
    .lt("start_datetime", nowIso)
    .order("start_datetime", { ascending: false })
    .returns<OccurrenceRow[]>();

  if (occurrenceError) {
    throw new Error(`Failed to load your classes: ${occurrenceError.message}`);
  }

  const occurrences = occurrenceData ?? [];
  const occurrenceById = new Map(occurrences.map((o) => [o.id, o]));
  const occurrenceIds = occurrences.map((o) => o.id);

  let prospects: Prospect[] = [];

  if (occurrenceIds.length > 0) {
    // Checked-in attendance for those classes. One member can appear across
    // several classes -- we keep only their most recent check-in (the
    // occurrence list is already sorted newest-first).
    const { data: visits, error: visitError } = await supabase
      .from("class_visits")
      .select("occurrence_id, client_mindbody_unique_id")
      .eq("signed_in", true)
      .in("occurrence_id", occurrenceIds);

    if (visitError) {
      throw new Error(`Failed to load class attendance: ${visitError.message}`);
    }

    // occurrences is newest-first, so its index is a recency rank. For each
    // member keep the occurrence they most recently checked in to.
    const occurrenceRank = new Map(occurrences.map((o, index) => [o.id, index]));
    const latestVisitByUid = new Map<number, string>();
    for (const visit of visits ?? []) {
      const rank = occurrenceRank.get(visit.occurrence_id);
      if (rank === undefined) {
        continue;
      }
      const current = latestVisitByUid.get(visit.client_mindbody_unique_id);
      if (current === undefined || rank < (occurrenceRank.get(current) ?? Infinity)) {
        latestVisitByUid.set(visit.client_mindbody_unique_id, visit.occurrence_id);
      }
    }

    const clientUids = [...latestVisitByUid.keys()];

    if (clientUids.length > 0) {
      // Only members with an email on file -- that's the whole roster the
      // relay can actually reach (clients.email is populated only for
      // checked-in members; see lib/sync/clients.ts).
      const { data: clientData, error: clientError } = await supabase
        .from("clients")
        .select("id, mindbody_unique_id, first_name, last_name, email")
        .in("mindbody_unique_id", clientUids)
        .not("email", "is", null)
        .returns<ClientRow[]>();

      if (clientError) {
        throw new Error(`Failed to load members: ${clientError.message}`);
      }

      const { data: conversationData } = await supabase
        .from("followup_conversations")
        .select("id, client_id")
        .eq("instructor_id", currentStaff.id);

      const conversationByClientId = new Map(
        (conversationData ?? []).map((c) => [c.client_id, c.id as string]),
      );

      prospects = (clientData ?? [])
        .map((client) => {
          const occurrenceId = latestVisitByUid.get(client.mindbody_unique_id);
          const occurrence = occurrenceId ? occurrenceById.get(occurrenceId) : undefined;
          return {
            clientId: client.id,
            name: `${client.first_name} ${client.last_name}`.trim(),
            lastClassName: occurrence?.class_name ?? "a class",
            lastClassAt: occurrence?.start_datetime ?? null,
            conversationId: conversationByClientId.get(client.id) ?? null,
          };
        })
        .sort((a, b) => (b.lastClassAt ?? "").localeCompare(a.lastClassAt ?? ""));
    }
  }

  return (
    <DashboardShell title={TITLE} description={DESCRIPTION}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CurrentUserBanner displayName={currentStaff.displayName} role={currentStaff.role} />
        <p className="text-sm text-zinc-500">
          Checked in during the last {ROSTER_WINDOW_DAYS} days
        </p>
      </div>

      <div className="mt-6">
        {prospects.length === 0 ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-base font-semibold text-zinc-950">No one to follow up with yet</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Members show up here once they&apos;ve checked in to one of your classes and we have
              an email address on file for them.
            </p>
          </section>
        ) : (
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {prospects.map((prospect) => (
              <li
                key={prospect.clientId}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-950">{prospect.name}</p>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    Last checked in to {prospect.lastClassName}
                    {prospect.lastClassAt
                      ? ` on ${DateTime.fromISO(prospect.lastClassAt, { zone: "utc" })
                          .setZone(timezone)
                          .toFormat("EEE, MMM d")}`
                      : ""}
                  </p>
                </div>
                <FollowUpComposer
                  clientId={prospect.clientId}
                  clientName={prospect.name}
                  conversationId={prospect.conversationId}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardShell>
  );
}
