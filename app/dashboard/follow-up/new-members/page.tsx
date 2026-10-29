import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { FollowUpTabs } from "@/components/crm/follow-up-tabs";
import { PresetRangeSelect } from "@/components/dashboard/preset-range-select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireCrmModuleStaff } from "@/lib/crm/module";
import { loadNewMembers, newMemberStats } from "@/lib/crm/new-members";
import { INTRO_LABELS, type IntroStatus } from "@/lib/crm/onboarding";
import { getCrmOrg } from "@/lib/crm/org";
import { resolvePeriod } from "@/lib/crm/period";
import { getScopedClient } from "@/lib/supabase/scoped";

export const dynamic = "force-dynamic";

const PRESETS = [
  { value: "60", label: "Last 60 days" },
  { value: "mtd", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Pick dates" },
];

const INTRO_VARIANT: Record<IntroStatus, "default" | "secondary" | "outline" | "destructive"> = {
  done: "default",
  booked: "secondary",
  none: "outline",
  no_show: "destructive",
  late_cancel: "destructive",
};

// A trainer's new members: the ones an admin assigned to them for an intro
// workout. Opening one shows the same profile salespeople use (message
// history, texts, emails, logged calls, notes). Only their own members --
// the database's row security enforces that too.
export default async function TrainerNewMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
}) {
  const staff = await requireCrmModuleStaff();
  const params = await searchParams;
  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const period = resolvePeriod(params, {
    presets: PRESETS.map((preset) => preset.value),
    fallback: "60",
    timezone: org.timezone,
  });

  const { data: orgRow } = await supabase
    .from("organizations")
    .select("crm_intro_session_type_id")
    .eq("id", staff.organizationId)
    .maybeSingle();
  const rows = await loadNewMembers(supabase, {
    fromIso: period.from.toUTC().toISO()!,
    toIso: period.to.toUTC().toISO()!,
    trainerStaffId: staff.id,
    introSessionTypeId: (orgRow?.crm_intro_session_type_id as number | null) ?? null,
  });
  const stats = newMemberStats(rows);
  const local = (iso: string | null, format: string) =>
    iso ? DateTime.fromISO(iso).setZone(org.timezone).toFormat(format) : null;

  return (
    <DashboardShell title="Follow Up" description="New members assigned to you. Reach out to book their intro workout.">
      <FollowUpTabs active="new-members" newMembersBadge={rows.filter((row) => !row.firstContactAt).length} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {stats.enrolled} assigned · {stats.contacted} contacted · {stats.introBooked} intro booked · {stats.introDone}{" "}
          done
        </p>
        <PresetRangeSelect
          presets={PRESETS}
          paramNames={{ preset: "range", start: "start", end: "end" }}
          value={period.preset}
          start={period.start}
          end={period.end}
          ariaLabel="Enrolled"
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <h2 className="text-base font-semibold">No new members assigned to you</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              When an admin assigns you a new member for their intro workout, they&apos;ll show up here and you&apos;ll
              get a notification.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/dashboard/guests/${row.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {row.name}
                    {row.unread > 0 ? (
                      <Badge className="ml-2" variant="default">
                        {row.unread} new
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Enrolled {local(row.enrolledAt, "LLL d")}
                    {row.membership ? ` · ${row.membership}` : ""}
                    {row.assignedAt ? ` · assigned ${local(row.assignedAt, "LLL d")}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.lastContactAt
                      ? `Last contact ${local(row.lastContactAt, "LLL d, h:mm a")}`
                      : "You haven't reached out yet"}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant={INTRO_VARIANT[row.intro.status]}>{INTRO_LABELS[row.intro.status]}</Badge>
                  {row.intro.at ? (
                    <p className="mt-1 text-xs text-muted-foreground">{local(row.intro.at, "ccc, LLL d, h:mm a")}</p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Book the intro workout in Mindbody as usual; it shows here as booked the next morning.
      </p>
    </DashboardShell>
  );
}
