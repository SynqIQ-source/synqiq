import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { describeSessionRate, getTrainerPilot, lookupSessionRate } from "@/lib/trainer/pilot";
import { PilotOff } from "../trainer-calendar/pilot-off";
import { RateForm } from "./rate-form";

export const dynamic = "force-dynamic";

// Club Admins: trainer session rates (pilot). Each change is a new row from
// its start date; pay lines keep the rate they were recorded with. Where a
// trainer has no rate here, their rate on the Pay Rates page is used.
export default async function TrainerRatesPage() {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const pilot = await getTrainerPilot(org);
  if (!pilot.on)
    return (
      <DashboardShell title="Trainer Session Rates" description="Trainer sessions pilot.">
        <PilotOff admin />
      </DashboardShell>
    );
  const today = DateTime.now().setZone(pilot.timezone).toISODate()!;
  const [{ data: trainerRows }, { data: typeRows }, { data: rateRows }] = await Promise.all([
    admin.from("staff").select("id, display_name").eq("organization_id", org).eq("is_trainer", true).is("archived_at", null).order("display_name"),
    admin
      .from("session_types")
      .select("mindbody_session_type_id, name")
      .eq("organization_id", org)
      .eq("kind", "Appointment")
      .in("mindbody_program_id", [2, 4, 5])
      .order("name"),
    admin
      .from("trainer_session_rates")
      .select("id, staff_id, session_type_id, method, percent_bp, flat_cents, effective_from, note, created_by_staff_id, created_at")
      .eq("organization_id", org)
      .order("effective_from", { ascending: false }),
  ]);
  const trainers = (trainerRows ?? []).map((row) => ({ id: row.id as string, name: (row.display_name as string | null) ?? "Trainer" }));
  const types = (typeRows ?? []).map((row) => ({ id: Number(row.mindbody_session_type_id), name: row.name as string }));
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const trainerName = new Map(trainers.map((t) => [t.id, t.name]));
  const current = await Promise.all(
    trainers.map(async (t) => ({ trainer: t, rate: await lookupSessionRate(admin, org, t.id, null, today) })),
  );

  return (
    <DashboardShell
      title="Trainer Session Rates"
      description="Pilot: what each trainer earns per session. A change starts on a date and never alters pay already recorded."
    >
      <div className="mb-4">
        <Badge variant="outline" className="border-amber-400 text-amber-900 dark:text-amber-200">
          Pilot
        </Badge>
      </div>
      <RateForm trainers={trainers} types={types} today={today} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Default rate today</CardTitle>
          <CardDescription>
            Each trainer&apos;s rate for a session with no session-type rate. &quot;Pay Rates page&quot; means no pilot rate is set, so their
            rate on the Pay Rates page is used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trainer</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>From</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.map(({ trainer, rate }) => (
                <TableRow key={trainer.id}>
                  <TableCell>{trainer.name}</TableCell>
                  <TableCell>{rate ? (rate.source === "dated" ? describeSessionRate(rate) : `${rate.name} (Pay Rates page)`) : "No rate set"}</TableCell>
                  <TableCell className="text-muted-foreground">{rate?.effectiveFrom ? DateTime.fromISO(rate.effectiveFrom).toFormat("LLL d, yyyy") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Every rate ever set, newest start date first. Rates are never edited; a change is a new line.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rateRows?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trainer</TableHead>
                  <TableHead>Session type</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rateRows.map((row) => (
                  <TableRow key={row.id as string}>
                    <TableCell>{trainerName.get(row.staff_id as string) ?? "Former trainer"}</TableCell>
                    <TableCell>
                      {row.session_type_id == null ? "Any (default)" : (typeName.get(Number(row.session_type_id)) ?? `Type ${row.session_type_id}`)}
                    </TableCell>
                    <TableCell>
                      {describeSessionRate({
                        method: row.method as "percent" | "flat",
                        percentBp: row.percent_bp == null ? null : Number(row.percent_bp),
                        flatCents: row.flat_cents == null ? null : Number(row.flat_cents),
                      })}
                    </TableCell>
                    <TableCell>{DateTime.fromISO(String(row.effective_from)).toFormat("LLL d, yyyy")}</TableCell>
                    <TableCell className="text-muted-foreground">{(row.note as string | null) ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No pilot rates yet. Until one is set, trainers are paid at their Pay Rates page rate.</p>
          )}
        </CardContent>
      </Card>
    </DashboardShell>
  );
}
