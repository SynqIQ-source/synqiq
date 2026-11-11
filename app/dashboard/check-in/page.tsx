import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  method: string;
  coverage_kind: "membership" | "pass" | "none";
  coverage_name: string | null;
  billing_standing: "good" | "attention" | "none";
  standing_reasons: string[];
  warnings: string[];
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  checked_in_by_staff_id: string | null;
};

const FILTERS = {
  all: "Everyone",
  membership: "On a membership",
  pass: "On a pass",
  none: "Nothing covering it",
  attention: "Declined, terminated or frozen",
  good: "Good standing",
} as const;
type Filter = keyof typeof FILTERS;

const ROW_TONE: Record<Row["billing_standing"], string> = {
  good: "bg-emerald-50/70 hover:bg-emerald-50 dark:bg-emerald-950/30",
  attention: "bg-red-50 hover:bg-red-100/70 dark:bg-red-950/40",
  none: "",
};

// Front-desk check-in for gym visits, attributed to the membership or pass
// that covers each one, with a drill-down by category and day.
export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ show?: string; date?: string }> }) {
  const staff = await requireAccess(canCheckIn);
  const supabase = await getScopedClient(staff);
  const params = await searchParams;
  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const timezone = (org?.timezone as string | undefined) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date <= today ? params.date : today;
  const filter: Filter = params.show && params.show in FILTERS ? (params.show as Filter) : "all";

  const { data: rows } = await supabase
    .from("check_ins")
    .select(
      "id, mindbody_client_id, client_name, checked_in_at, method, coverage_kind, coverage_name, billing_standing, standing_reasons, warnings, note, voided_at, void_reason, checked_in_by_staff_id",
    )
    .eq("organization_id", staff.organizationId)
    .eq("local_date", date)
    .order("checked_in_at", { ascending: false })
    .returns<Row[]>();
  const staffIds = [...new Set((rows ?? []).map((row) => row.checked_in_by_staff_id).filter((id): id is string => Boolean(id)))];
  const { data: staffRows } = staffIds.length
    ? await supabase.from("staff").select("id, display_name").in("id", staffIds)
    : { data: [] as { id: string; display_name: string }[] };
  const staffName = new Map((staffRows ?? []).map((row) => [row.id as string, row.display_name as string]));

  const live = (rows ?? []).filter((row) => !row.voided_at);
  const matches = (row: Row, which: Filter) =>
    which === "all" || (which === "attention" || which === "good" ? row.billing_standing === which : row.coverage_kind === which);
  const counts = Object.fromEntries(
    (Object.keys(FILTERS) as Filter[]).map((key) => [key, live.filter((row) => matches(row, key)).length]),
  ) as Record<Filter, number>;
  const shown = (rows ?? []).filter((row) => (row.voided_at ? filter === "all" : matches(row, filter)));
  const admin = isClubAdmin(staff);
  const href = (next: { show?: Filter; date?: string }) => {
    const query = new URLSearchParams();
    const show = next.show ?? filter;
    const day = next.date ?? date;
    if (show !== "all") query.set("show", show);
    if (day !== today) query.set("date", day);
    const text = query.toString();
    return `/dashboard/check-in${text ? `?${text}` : ""}`;
  };
  const day = DateTime.fromISO(date);

  return (
    <DashboardShell
      title="Check-in"
      description="Scan a key card or look someone up. Each visit is matched to the membership or pass that covers it."
    >
      <div className="space-y-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Until the switch, Mindbody still records arrivals. SynqIQ check-ins are its own record for the parallel run.
        </div>
        {date === today ? (
          <Card>
            <CardContent className="py-2">
              <CheckInDesk />
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={href({ date: day.minus({ days: 1 }).toISODate()! })} aria-label="Previous day">
              <ChevronLeft />
            </Link>
          </Button>
          <span className="text-sm font-medium">{date === today ? "Today" : day.toFormat("cccc, LLL d")}</span>
          {date < today ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={href({ date: day.plus({ days: 1 }).toISODate()! })} aria-label="Next day">
                  <ChevronRight />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={href({ date: today })}>Today</Link>
              </Button>
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(FILTERS) as Filter[]).map((key) => (
            <Link
              key={key}
              href={href({ show: key })}
              className={`rounded-lg border px-3 py-2 transition-colors hover:bg-muted ${filter === key ? "border-primary ring-1 ring-primary" : ""} ${
                key === "attention" && counts.attention ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40" : ""
              } ${key === "good" && counts.good ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : ""}`}
            >
              <p className="text-xs font-medium text-muted-foreground">{FILTERS[key]}</p>
              <p className="text-xl font-semibold tabular-nums">{counts[key]}</p>
            </Link>
          ))}
        </div>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>
              {FILTERS[filter]} · {filter === "all" ? live.length : counts[filter]}
            </CardTitle>
            <CardDescription>Red: declined, terminated or frozen. Green: covered and in good standing.</CardDescription>
          </CardHeader>
          {shown.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Nobody here.</p>
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
                  {shown.map((row) => (
                    <TableRow key={row.id} className={row.voided_at ? "text-muted-foreground" : ROW_TONE[row.billing_standing]}>
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
                        {!row.voided_at && row.billing_standing === "attention" ? (
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {row.standing_reasons.map((reason) => (
                              <Badge key={reason} variant="destructive">
                                {reason}
                              </Badge>
                            ))}
                          </span>
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
                        {row.method === "scan"
                          ? "Key card"
                          : row.checked_in_by_staff_id
                            ? (staffName.get(row.checked_in_by_staff_id) ?? "Staff")
                            : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.voided_at || (date !== today && !admin) ? null : <UndoCheckIn id={row.id} />}
                      </TableCell>
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
