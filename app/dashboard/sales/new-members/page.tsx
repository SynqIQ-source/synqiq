import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { percent } from "@/lib/crm/funnel";
import { requireCrmStaff } from "@/lib/crm/module";
import { loadNewMembers, newMemberStats } from "@/lib/crm/new-members";
import { INTRO_LABELS } from "@/lib/crm/onboarding";
import { getCrmOrg } from "@/lib/crm/org";
import { resolvePeriod } from "@/lib/crm/period";
import { getScopedClient } from "@/lib/supabase/scoped";
import { cn } from "@/lib/utils";
import { NewMembersFilters } from "./new-members-filters";
import { NewMembersTable, type MemberTableRow } from "./new-members-table";

export const dynamic = "force-dynamic";

const PRESETS = ["mtd", "7", "30", "last_month", "custom"];

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", highlight ? "border-primary/40 bg-primary/5" : "bg-card")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

// New member onboarding for admins (the fitness director's view): members
// who enrolled in the period, assigning each to a trainer, and how far the
// outreach got -- contacted, intro booked, intro done. Admin + CRM only.
export default async function NewMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; start?: string; end?: string; trainer?: string }>;
}) {
  const staff = await requireCrmStaff();
  if (staff.role !== "admin") notFound();
  const params = await searchParams;
  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const period = resolvePeriod(params, { presets: PRESETS, fallback: "mtd", timezone: org.timezone });

  const [{ data: staffRows, error: staffError }, { data: orgRow }] = await Promise.all([
    supabase.from("staff").select("id, display_name, archived_at, auth_user_id").order("display_name"),
    supabase.from("organizations").select("crm_intro_session_type_id").eq("id", staff.organizationId).maybeSingle(),
  ]);
  if (staffError) throw new Error("Failed to load staff.");
  const staffNames = new Map((staffRows ?? []).map((row) => [row.id as string, row.display_name as string]));
  // Anyone who can sign in can be a member's trainer.
  const trainers = (staffRows ?? [])
    .filter((row) => !row.archived_at && row.auth_user_id)
    .map((row) => ({ id: row.id as string, name: row.display_name as string }));
  const trainerParam =
    params.trainer === "unassigned" || trainers.some((trainer) => trainer.id === params.trainer)
      ? params.trainer!
      : "all";

  const rows = await loadNewMembers(supabase, {
    fromIso: period.from.toUTC().toISO()!,
    toIso: period.to.toUTC().toISO()!,
    trainerStaffId: trainerParam === "all" ? null : trainerParam,
    introSessionTypeId: (orgRow?.crm_intro_session_type_id as number | null) ?? null,
  });
  const stats = newMemberStats(rows);

  // Per trainer, over the members assigned to them.
  const byTrainer = [...new Set(rows.map((row) => row.trainerId).filter((id): id is string => Boolean(id)))]
    .map((id) => {
      const theirs = rows.filter((row) => row.trainerId === id);
      return { id, name: staffNames.get(id) ?? "Staff", stats: newMemberStats(theirs) };
    })
    .sort((a, b) => b.stats.enrolled - a.stats.enrolled || a.name.localeCompare(b.name));

  const local = (iso: string | null, format = "LLL d") =>
    iso ? DateTime.fromISO(iso).setZone(org.timezone).toFormat(format) : null;
  const tableRows: MemberTableRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    enrolled: local(row.enrolledAt, "LLL d, yyyy")!,
    enrollmentPending: row.enrollmentPending,
    membership: row.membership,
    soldBy: row.soldById ? (staffNames.get(row.soldById) ?? null) : null,
    trainerId: row.trainerId,
    assigned: local(row.assignedAt),
    lastContact: local(row.lastContactAt, "LLL d, h:mm a"),
    contactCount: row.contactCount,
    unread: row.unread,
    introStatus: row.intro.status,
    introLabel: INTRO_LABELS[row.intro.status],
    introAt: local(row.intro.at, "LLL d, h:mm a"),
  }));

  const periodLabel = `${period.from.toFormat("LLL d")} – ${period.to.toFormat("LLL d, yyyy")}`;

  return (
    <DashboardShell
      title="New Members"
      description={`Enrolled ${periodLabel} · assign a trainer for each intro workout`}
      actions={
        <NewMembersFilters
          range={period.preset}
          start={period.start}
          end={period.end}
          trainer={trainerParam}
          trainers={trainers}
        />
      }
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Onboarding</CardTitle>
            <CardDescription>
              Members who enrolled in this period (by contract start date) and how far their intro got.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Enrolled" value={String(stats.enrolled)} />
            <Stat
              label="Assigned"
              value={String(stats.assigned)}
              sub={`${percent(stats.assigned, stats.enrolled)} of new members`}
            />
            <Stat
              label="Contacted"
              value={String(stats.contacted)}
              sub={`${stats.contactedWithin48h} within 48 hours of assignment`}
            />
            <Stat
              label="Intro booked"
              value={String(stats.introBooked)}
              sub={`${percent(stats.introBooked, stats.enrolled)} of new members`}
            />
            <Stat
              label="Intro done"
              value={String(stats.introDone)}
              sub={`${percent(stats.introDone, stats.introBooked)} of booked`}
              highlight
            />
          </CardContent>
        </Card>

        {byTrainer.length > 0 ? (
          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle>By trainer</CardTitle>
              <CardDescription>Members assigned to each trainer in this period.</CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trainer</TableHead>
                    <TableHead className="text-right">Assigned</TableHead>
                    <TableHead className="text-right">Contacted</TableHead>
                    <TableHead className="text-right">Within 48h</TableHead>
                    <TableHead className="text-right">Intro booked</TableHead>
                    <TableHead className="text-right">Intro done</TableHead>
                    <TableHead className="text-right">Done %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byTrainer.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.stats.enrolled}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.stats.contacted}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.stats.contactedWithin48h}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.stats.introBooked}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.stats.introDone}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {percent(row.stats.introDone, row.stats.enrolled)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        ) : null}

        <NewMembersTable rows={tableRows} trainers={trainers} />

        <p className="text-xs text-muted-foreground">
          New members appear the morning after they turn Active in Mindbody; their enrollment date updates to the
          contract start date shortly after. Intro status comes from Mindbody Intro Workout appointments (synced
          nightly, including the next 3 weeks). &ldquo;Contacted&rdquo; counts texts, emails and logged calls by the
          assigned trainer.
        </p>
      </div>
    </DashboardShell>
  );
}
