import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { costSummary, money, STATUS_LABELS, type IssueStatus } from "@/lib/maintenance/rules";

export const dynamic = "force-dynamic";

// One piece of equipment: details and its full repair history -- every
// issue, the vendor, how long it took, quoted and paid -- with lifetime cost.
export default async function EquipmentHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await getScopedClient(staff);
  const { data: item } = await supabase.from("maintenance_equipment").select("*").eq("id", id).maybeSingle();
  if (!item) notFound();
  const [{ data: issues }, { data: vendors }, { data: org }] = await Promise.all([
    supabase
      .from("maintenance_issues")
      .select("id, title, status, is_critical, created_at, resolved_at, vendor_id")
      .eq("equipment_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("maintenance_vendors").select("id, name"),
    supabase.from("organizations").select("timezone").maybeSingle(),
  ]);
  const ids = (issues ?? []).map((issue) => issue.id as string);
  const { data: money_events } = ids.length
    ? await supabase.from("maintenance_events").select("issue_id, kind, amount_cents").in("issue_id", ids).in("kind", ["quote", "paid"])
    : { data: [] };
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const local = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("LLL d, yyyy");
  const vendorName = new Map((vendors ?? []).map((vendor) => [vendor.id as string, vendor.name as string]));
  const total = costSummary(money_events ?? []);

  return (
    <DashboardShell
      title={item.name as string}
      description={[
        item.area,
        item.model_number ? `Model ${item.model_number}` : null,
        item.serial_number ? `Serial ${item.serial_number}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/maintenance?tab=equipment">← Equipment</Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Issues" value={String(ids.length)} />
          <Stat label="Open" value={String((issues ?? []).filter((issue) => issue.status !== "resolved").length)} />
          <Stat label="Quoted" value={money(total.quotedCents)} />
          <Stat label="Paid to date" value={money(total.paidCents)} />
        </div>
        {item.notes ? (
          <Card>
            <CardContent className="pt-6 text-sm whitespace-pre-wrap">{item.notes as string}</CardContent>
          </Card>
        ) : null}
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Repair history</CardTitle>
            <CardDescription>Newest first. Paid = payments recorded on each issue.</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reported</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Days to fix</TableHead>
                <TableHead className="text-right">Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(issues ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No issues reported for this piece.
                  </TableCell>
                </TableRow>
              ) : (
                (issues ?? []).map((issue) => {
                  const paid = costSummary((money_events ?? []).filter((event) => event.issue_id === issue.id)).paidCents;
                  return (
                    <TableRow key={issue.id}>
                      <TableCell className="whitespace-nowrap">{local(issue.created_at as string)}</TableCell>
                      <TableCell>
                        <Link href={`/dashboard/maintenance/${issue.id}`} className="font-medium hover:underline">
                          {issue.title}
                        </Link>
                        {issue.is_critical ? (
                          <Badge variant="destructive" className="ml-2">
                            Critical
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{issue.vendor_id ? (vendorName.get(issue.vendor_id as string) ?? "—") : "—"}</TableCell>
                      <TableCell>{STATUS_LABELS[issue.status as IssueStatus]}</TableCell>
                      <TableCell className="text-right">
                        {issue.resolved_at
                          ? Math.max(
                              0,
                              Math.round(
                                DateTime.fromISO(issue.resolved_at as string).diff(DateTime.fromISO(issue.created_at as string), "days")
                                  .days,
                              ),
                            )
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">{paid ? money(paid) : "—"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="py-4">
      <CardContent>
        <p className="text-xs text-muted-foreground uppercase">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
