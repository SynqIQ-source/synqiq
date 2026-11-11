import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { canCheckIn, isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { CheckInDesk } from "./check-in-desk";
import { UndoCheckIn } from "./undo-check-in";

type Row = {
  id: string;
  mindbody_client_id: string;
  client_name: string;
  checked_in_at: string;
  coverage_kind: "membership" | "pass" | "none";
  coverage_name: string | null;
  warnings: string[];
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  checked_in_by_staff_id: string | null;
};

// Front-desk check-in for gym visits, attributed to the membership or pass
// that covers each one.
export default async function CheckInPage() {
  const staff = await requireAccess(canCheckIn);
  const supabase = await getScopedClient(staff);
  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const timezone = (org?.timezone as string | undefined) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const { data: rows } = await supabase
    .from("check_ins")
    .select(
      "id, mindbody_client_id, client_name, checked_in_at, coverage_kind, coverage_name, warnings, note, voided_at, void_reason, checked_in_by_staff_id",
    )
    .eq("organization_id", staff.organizationId)
    .eq("local_date", today)
    .order("checked_in_at", { ascending: false })
    .returns<Row[]>();
  const staffIds = [...new Set((rows ?? []).map((row) => row.checked_in_by_staff_id).filter((id): id is string => Boolean(id)))];
  const { data: staffRows } = staffIds.length
    ? await supabase.from("staff").select("id, display_name").in("id", staffIds)
    : { data: [] as { id: string; display_name: string }[] };
  const staffName = new Map((staffRows ?? []).map((row) => [row.id as string, row.display_name as string]));
  const live = (rows ?? []).filter((row) => !row.voided_at);
  const count = (kind: Row["coverage_kind"]) => live.filter((row) => row.coverage_kind === kind).length;
  const admin = isClubAdmin(staff);

  return (
    <DashboardShell
      title="Check-in"
      description="Check members and pass holders in for the gym. Each visit is matched to the membership or pass that covers it."
    >
      <div className="space-y-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Until the switch, Mindbody still records arrivals. SynqIQ check-ins are its own record for the parallel run.
        </div>
        <Card>
          <CardContent className="py-2">
            <CheckInDesk />
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Today · {live.length} checked in</CardTitle>
            <CardDescription>
              {count("membership")} on a membership · {count("pass")} on a pass · {count("none")} without one
            </CardDescription>
          </CardHeader>
          {(rows ?? []).length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Nobody yet today.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Covered by</TableHead>
                    <TableHead>Checked in by</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rows ?? []).map((row) => (
                    <TableRow key={row.id} className={row.voided_at ? "text-muted-foreground" : undefined}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {DateTime.fromISO(row.checked_in_at).setZone(timezone).toFormat("h:mm a")}
                      </TableCell>
                      <TableCell>
                        {admin ? (
                          <Link
                            href={`/dashboard/memberships/${row.mindbody_client_id}`}
                            className={`font-medium underline-offset-4 hover:underline ${row.voided_at ? "line-through" : ""}`}
                          >
                            {row.client_name}
                          </Link>
                        ) : (
                          <span className={`font-medium ${row.voided_at ? "line-through" : ""}`}>{row.client_name}</span>
                        )}
                        {row.warnings?.length && !row.voided_at ? (
                          <span className="block text-xs text-amber-700 dark:text-amber-300">{row.warnings.join(" ")}</span>
                        ) : null}
                        {row.voided_at ? <span className="block text-xs">Undone: {row.void_reason}</span> : null}
                      </TableCell>
                      <TableCell>
                        {row.coverage_kind === "none" ? (
                          <>
                            <Badge variant="destructive">Nothing</Badge>
                            {row.note ? <span className="block text-xs text-muted-foreground">{row.note}</span> : null}
                          </>
                        ) : (
                          <>
                            <Badge variant={row.coverage_kind === "membership" ? "secondary" : "outline"}>
                              {row.coverage_kind === "membership" ? "Membership" : "Pass"}
                            </Badge>
                            <span className="block text-xs text-muted-foreground">{row.coverage_name}</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.checked_in_by_staff_id ? (staffName.get(row.checked_in_by_staff_id) ?? "Staff") : "—"}
                      </TableCell>
                      <TableCell className="text-right">{row.voided_at ? null : <UndoCheckIn id={row.id} />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
