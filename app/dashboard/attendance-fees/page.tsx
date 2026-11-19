import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { managesSales } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { feeTotals, type FeeRow } from "@/lib/booking/fees";

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// No-shows and late cancels on SynqIQ class and pool lane bookings, with the
// fee each one recorded (the program's fee at the time). Nothing is charged
// from here yet; this is the list fees will be charged from. Club Admins and
// Sales Leads. Mindbody's own no-shows aren't included.
export default async function AttendanceFeesPage({ searchParams }: Props) {
  const staff = await requireAccess(managesSales);
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const params = await searchParams;
  const valid = (value?: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const now = DateTime.now().setZone(zone);
  const from = valid(params.from) ?? now.startOf("month").toISODate()!;
  const to = valid(params.to) && valid(params.to)! >= from ? valid(params.to)! : now.toISODate()!;

  const { data } = await admin
    .from("class_bookings")
    .select(
      "id, mindbody_client_id, client_name, status, late_cancel_fee_cents, no_show_fee_cents, cancel_reason, session:class_sessions!inner ( id, class_name, starts_at, local_date )",
    )
    .eq("organization_id", staff.organizationId)
    .in("status", ["no_show", "late_cancelled"])
    .gte("session.local_date", from)
    .lte("session.local_date", to)
    .limit(5000);
  const rows: FeeRow[] = (data ?? [])
    .map((row) => {
      const session = row.session as unknown as { class_name: string; starts_at: string };
      return {
        id: row.id as string,
        clientId: row.mindbody_client_id as string,
        name: row.client_name as string,
        status: row.status as FeeRow["status"],
        feeCents: Number((row.status === "no_show" ? row.no_show_fee_cents : row.late_cancel_fee_cents) ?? 0),
        className: session.class_name,
        startsAt: session.starts_at,
      };
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const totals = feeTotals(rows);

  return (
    <DashboardShell
      title="No-shows & Late Cancels"
      description="Late cancels and no-shows on classes and pool lanes booked in SynqIQ, with the fee each one carries. Nothing is charged from here yet."
    >
      <div className="space-y-4">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="text-sm">
            From
            <Input type="date" name="from" defaultValue={from} className="h-9" />
          </label>
          <label className="text-sm">
            To
            <Input type="date" name="to" defaultValue={to} className="h-9" />
          </label>
          <Button type="submit" variant="outline" size="sm">
            Show
          </Button>
        </form>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">No-shows</p>
              <p className="text-2xl font-semibold">{totals.noShows}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Late cancels</p>
              <p className="text-2xl font-semibold">{totals.lateCancels}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Fees (not charged yet)</p>
              <p className="text-2xl font-semibold">{money(totals.feeCents)}</p>
            </CardContent>
          </Card>
        </div>

        <Card className="py-0">
          {rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No no-shows or late cancels in these dates.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-4">When</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Class or lane</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead className="pr-4 text-right">Fee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4 whitespace-nowrap">
                      {DateTime.fromISO(row.startsAt).setZone(zone).toFormat("ccc LLL d, h:mm a")}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/dashboard/memberships/${encodeURIComponent(row.clientId)}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell>{row.className}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === "no_show" ? "destructive" : "secondary"}>
                        {row.status === "no_show" ? "No show" : "Late cancel"}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{row.feeCents ? money(row.feeCents) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
