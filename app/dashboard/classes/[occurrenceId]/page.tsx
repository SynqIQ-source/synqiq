import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ArrowLeft } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { requireModule } from "@/lib/modules";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { asOccurrenceId } from "@/lib/mindbody/types";
import { ROSTER_LABELS, buildRoster, rosterCounts, type MindbodyRosterVisit, type RosterEntry } from "@/lib/classes/roster";

type Params = Promise<{ occurrenceId: string }>;

const BADGE: Record<RosterEntry["status"], "secondary" | "outline" | "destructive"> = {
  checked_in: "secondary",
  booked: "outline",
  no_show: "destructive",
  late_cancel: "destructive",
};

// Who is in a class (any staff member). Until the switch the roster is
// Mindbody's, read live when the page opens (one read-only call), with the
// last synced roster as a fallback.
export default async function ClassRosterPage({ params }: { params: Params }) {
  await requireModule("group_fitness");
  const staff = await requireAccess(() => true);
  const { occurrenceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(occurrenceId)) notFound();
  const supabase = await getScopedClient(staff);

  const { data: occurrence } = await supabase
    .from("class_occurrences")
    .select(
      `id, class_name, start_datetime, end_datetime, max_capacity, total_booked, total_signed_in, mindbody_occurrence_id, instructor_name,
       staff:staff!class_occurrences_staff_id_fkey ( display_name ),
       room:rooms!class_occurrences_room_id_fkey ( name ),
       organization:organizations!class_occurrences_organization_id_fkey ( timezone, mindbody_site_id )`,
    )
    .eq("id", occurrenceId)
    .maybeSingle<{
      id: string;
      class_name: string | null;
      start_datetime: string;
      end_datetime: string | null;
      max_capacity: number | null;
      total_booked: number | null;
      total_signed_in: number | null;
      mindbody_occurrence_id: number | null;
      instructor_name: string | null;
      staff: { display_name: string } | null;
      room: { name: string } | null;
      organization: { timezone: string | null; mindbody_site_id: number | null } | null;
    }>();
  if (!occurrence) notFound();
  const timezone = occurrence.organization?.timezone ?? "America/Chicago";
  const start = DateTime.fromISO(occurrence.start_datetime).setZone(timezone);
  const end = occurrence.end_datetime ? DateTime.fromISO(occurrence.end_datetime).setZone(timezone) : null;

  // Live from Mindbody; fall back to the last synced roster.
  let visits: MindbodyRosterVisit[] = [];
  let live = false;
  let waitlist = 0;
  if (occurrence.mindbody_occurrence_id && occurrence.organization?.mindbody_site_id) {
    try {
      const mindbody = createMindbodyClient({ siteId: String(occurrence.organization.mindbody_site_id) });
      const token = await mindbody.requireAccessToken();
      const response = (await mindbody.getClassVisits(asOccurrenceId(occurrence.mindbody_occurrence_id), token)) as {
        Class?: { Visits?: MindbodyRosterVisit[]; TotalBookedWaitlist?: number | null };
      };
      visits = response.Class?.Visits ?? [];
      waitlist = response.Class?.TotalBookedWaitlist ?? 0;
      live = true;
    } catch (error) {
      console.error("[class-roster] live roster failed:", error instanceof Error ? error.message : error);
    }
  }
  if (!live) {
    const { data: stored } = await supabase
      .from("class_visits")
      .select("client_mindbody_unique_id, signed_in")
      .eq("occurrence_id", occurrence.id);
    visits = (stored ?? []).map((row) => ({ ClientUniqueId: Number(row.client_mindbody_unique_id), SignedIn: row.signed_in as boolean }));
  }

  // Names from SynqIQ's clients (by Mindbody unique id, which every visit has).
  const uniqueIds = [...new Set(visits.map((visit) => visit.ClientUniqueId).filter((id): id is number => typeof id === "number"))];
  const { data: clients } = uniqueIds.length
    ? await supabase
        .from("clients")
        .select("mindbody_unique_id, mindbody_client_id, first_name, last_name, status")
        .eq("organization_id", staff.organizationId)
        .in("mindbody_unique_id", uniqueIds)
    : {
        data: [] as {
          mindbody_unique_id: number;
          mindbody_client_id: string | null;
          first_name: string;
          last_name: string;
          status: string;
        }[],
      };
  const clientByUnique = new Map((clients ?? []).map((client) => [Number(client.mindbody_unique_id), client]));
  const roster = buildRoster(visits, (visit) => {
    const client = visit.ClientUniqueId ? clientByUnique.get(visit.ClientUniqueId) : undefined;
    return client ? `${client.first_name} ${client.last_name}`.trim() : "Client not synced yet";
  });
  const counts = rosterCounts(roster);
  const admin = isClubAdmin(staff);
  const instructor = occurrence.staff?.display_name ?? occurrence.instructor_name ?? "Unassigned";
  const isPast = (end ?? start) < DateTime.now();

  return (
    <DashboardShell
      title={occurrence.class_name?.trim() || "Class"}
      description={`${start.toFormat("cccc, LLL d · h:mm a")}${end ? `–${end.toFormat("h:mm a")}` : ""} · ${instructor}${
        occurrence.room?.name ? ` · ${occurrence.room.name}` : ""
      }`}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/classes?viewMode=day&date=${start.toISODate()}`}>
            <ArrowLeft /> Classes
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <Card className="py-4">
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="In class" value={`${counts.inClass}${occurrence.max_capacity ? ` / ${occurrence.max_capacity}` : ""}`} />
            <Stat label="Checked in" value={String(counts.checked_in)} />
            <Stat label={isPast ? "Booked, not checked in" : "Booked"} value={String(counts.booked + counts.no_show)} />
            <Stat label="Late cancels" value={String(counts.late_cancel)} />
            <Stat label="Waitlist" value={live ? String(waitlist) : "—"} />
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Who&apos;s in this class</CardTitle>
            <CardDescription>
              {live
                ? "From Mindbody just now. Mindbody still takes bookings and check-ins until the switch."
                : "Mindbody couldn't be reached, so this is the last synced roster (check-ins only, no late cancels)."}
            </CardDescription>
          </CardHeader>
          {roster.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Nobody booked.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Used</TableHead>
                    <TableHead>Booked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.map((entry, index) => {
                    const client = entry.uniqueId ? clientByUnique.get(entry.uniqueId) : undefined;
                    const memberLink = admin && client?.mindbody_client_id ? `/dashboard/memberships/${client.mindbody_client_id}` : null;
                    return (
                      <TableRow key={`${entry.uniqueId ?? index}`}>
                        <TableCell>
                          {memberLink ? (
                            <Link href={memberLink} className="font-medium underline-offset-4 hover:underline">
                              {entry.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{entry.name}</span>
                          )}
                          {client?.status && client.status !== "Active" ? (
                            <span className="block text-xs text-muted-foreground">{client.status}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={BADGE[entry.status]}>
                            {entry.status === "booked" && isPast ? "Not checked in" : ROSTER_LABELS[entry.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{entry.paidWith ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {live ? (entry.bookedOnline ? "Online" : "By staff") : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
