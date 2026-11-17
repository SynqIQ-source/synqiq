import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { costSummary, money, STATUS_LABELS, type IssueStatus } from "@/lib/maintenance/rules";
import { formatPhoneForDisplay } from "@/lib/crm/normalize";
import { EquipmentDialog, ReportIssueDialog, VendorDialog } from "./maintenance-client";

export const dynamic = "force-dynamic";

const OPEN_ORDER: IssueStatus[] = ["reported", "troubleshooting", "vendor_contacted", "vendor_replied", "visit_scheduled", "on_site"];

// Maintenance: open issues (critical first), upcoming vendor visits,
// recently resolved; the equipment register with what each piece has cost;
// vendors. Every staff member sees it and can report; Club Admins manage
// equipment and vendors.
export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  const params = await searchParams;
  const tab = params.tab === "equipment" || params.tab === "vendors" ? params.tab : "issues";
  const isAdmin = staff.role === "admin";
  const supabase = await getScopedClient(staff);
  const { data: org } = await createSupabaseAdminClient().from("organizations").select("timezone").eq("id", staff.organizationId).single();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const now = DateTime.now().setZone(zone);

  const [issuesResult, equipmentResult, vendorsResult, staffResult, costsResult, allIssuesResult] = await Promise.all([
    supabase
      .from("maintenance_issues")
      .select(
        "id, title, status, is_critical, equipment_id, location_text, created_at, next_visit_at, vendor_id, resolved_at, last_vendor_reply_at",
      )
      .or(`status.neq.resolved,resolved_at.gte.${now.minus({ days: 30 }).toUTC().toISO()}`)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("maintenance_equipment")
      .select("id, name, area, model_number, serial_number, is_critical, owner_staff_id, default_vendor_id, notes, archived_at")
      .order("name"),
    supabase.from("maintenance_vendors").select("id, name, contact_name, email, phone, notes, archived_at").order("name"),
    supabase.from("staff").select("id, display_name").is("archived_at", null).order("display_name"),
    tab === "equipment"
      ? supabase.from("maintenance_events").select("issue_id, kind, amount_cents").in("kind", ["quote", "paid"])
      : Promise.resolve({ data: [] as { issue_id: string; kind: string; amount_cents: number | null }[] }),
    // Every issue per piece (all time) for the equipment tab's counts and cost.
    tab === "equipment"
      ? supabase.from("maintenance_issues").select("id, equipment_id").not("equipment_id", "is", null).limit(10000)
      : Promise.resolve({ data: [] as { id: string; equipment_id: string | null }[] }),
  ]);
  if (issuesResult.error || equipmentResult.error || vendorsResult.error) throw new Error("Failed to load maintenance.");

  const equipment = equipmentResult.data ?? [];
  const activeEquipment = equipment.filter((item) => !item.archived_at);
  const vendors = (vendorsResult.data ?? []).filter((vendor) => !vendor.archived_at);
  const staffOptions = (staffResult.data ?? []).map((person) => ({ id: person.id as string, name: person.display_name as string }));
  const staffName = new Map(staffOptions.map((person) => [person.id, person.name]));
  const equipmentName = new Map(equipment.map((item) => [item.id as string, item]));
  const vendorName = new Map((vendorsResult.data ?? []).map((vendor) => [vendor.id as string, vendor.name as string]));
  const issues = issuesResult.data ?? [];
  const open = issues
    .filter((issue) => issue.status !== "resolved")
    .sort(
      (a, b) =>
        Number(b.is_critical) - Number(a.is_critical) ||
        OPEN_ORDER.indexOf(a.status as IssueStatus) - OPEN_ORDER.indexOf(b.status as IssueStatus) ||
        a.created_at.localeCompare(b.created_at),
    );
  const resolved = issues.filter((issue) => issue.status === "resolved");
  const visits = open
    .filter((issue) => issue.next_visit_at && issue.next_visit_at >= now.startOf("day").toUTC().toISO()!)
    .sort((a, b) => (a.next_visit_at as string).localeCompare(b.next_visit_at as string));
  const where = (issue: { equipment_id: string | null; location_text: string | null }) => {
    const item = issue.equipment_id ? equipmentName.get(issue.equipment_id) : null;
    return item ? `${item.name}${item.area ? ` · ${item.area}` : ""}` : (issue.location_text ?? "—");
  };
  const local = (iso: string, format: string) => DateTime.fromISO(iso).setZone(zone).toFormat(format);
  const tabs = [
    ["issues", `Issues (${open.length} open)`],
    ["equipment", `Equipment (${activeEquipment.length})`],
    ["vendors", `Vendors (${vendors.length})`],
  ] as const;

  return (
    <DashboardShell
      title="Maintenance"
      description="Report equipment problems, follow them through to fixed, and see what each piece has cost."
      actions={
        <ReportIssueDialog
          equipment={activeEquipment.map((item) => ({ id: item.id, name: item.name, area: item.area, isCritical: item.is_critical }))}
        />
      }
    >
      <div className="space-y-6">
        <div className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
          {tabs.map(([name, label]) => (
            <Link
              key={name}
              href={name === "issues" ? "/dashboard/maintenance" : `/dashboard/maintenance?tab=${name}`}
              className={`rounded-md px-3 py-1.5 ${tab === name ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {label}
            </Link>
          ))}
        </div>

        {tab === "issues" ? (
          <>
            {visits.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Vendor visits</CardTitle>
                  <CardDescription>Scheduled visits, soonest first. Make sure someone can let them in.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {visits.map((issue) => {
                    const at = DateTime.fromISO(issue.next_visit_at as string).setZone(zone);
                    const today = at.hasSame(now, "day");
                    return (
                      <Link
                        key={issue.id}
                        href={`/dashboard/maintenance/${issue.id}`}
                        className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                      >
                        {today ? <Badge>Today</Badge> : null}
                        <span className="font-medium">{at.toFormat("ccc LLL d, h:mm a")}</span>
                        <span>{issue.vendor_id ? (vendorName.get(issue.vendor_id) ?? "Vendor") : "Vendor"}</span>
                        <span className="text-muted-foreground">
                          · {issue.title} · {where(issue)}
                        </span>
                      </Link>
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}

            <Card className="py-0">
              <CardHeader className="pt-6">
                <CardTitle>Open issues</CardTitle>
                <CardDescription>Critical first, then by stage.</CardDescription>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Issue</TableHead>
                    <TableHead>Equipment / where</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Reported</TableHead>
                    <TableHead className="text-right">Days open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {open.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Nothing open. Use Report an issue when something breaks.
                      </TableCell>
                    </TableRow>
                  ) : (
                    open.map((issue) => (
                      <TableRow key={issue.id}>
                        <TableCell>
                          <Link href={`/dashboard/maintenance/${issue.id}`} className="font-medium underline-offset-2 hover:underline">
                            {issue.title}
                          </Link>
                          {issue.is_critical ? (
                            <Badge variant="destructive" className="ml-2">
                              Critical
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{where(issue)}</TableCell>
                        <TableCell>
                          <Badge variant={issue.status === "vendor_replied" ? "default" : "outline"}>
                            {STATUS_LABELS[issue.status as IssueStatus]}
                          </Badge>
                          {issue.next_visit_at ? (
                            <span className="ml-1.5 text-xs text-muted-foreground">{local(issue.next_visit_at, "LLL d, h:mm a")}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{issue.vendor_id ? (vendorName.get(issue.vendor_id) ?? "—") : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{local(issue.created_at, "LLL d")}</TableCell>
                        <TableCell className="text-right">
                          {Math.max(0, Math.floor(now.diff(DateTime.fromISO(issue.created_at), "days").days))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>

            {resolved.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Resolved in the last 30 days</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {resolved.map((issue) => (
                    <Link key={issue.id} href={`/dashboard/maintenance/${issue.id}`} className="block hover:underline">
                      {issue.resolved_at ? local(issue.resolved_at, "LLL d") : ""} · {issue.title}{" "}
                      <span className="text-muted-foreground">· {where(issue)}</span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}

        {tab === "equipment" ? (
          <Card className="py-0">
            <CardHeader className="pt-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Equipment</CardTitle>
                  <CardDescription>
                    Critical pieces send an urgent alert the day they&apos;re reported. Cost = payments recorded on its issues.
                  </CardDescription>
                </div>
                {isAdmin ? (
                  <EquipmentDialog
                    staff={staffOptions}
                    vendors={vendors.map((vendor) => ({ id: vendor.id, name: vendor.name, email: vendor.email }))}
                    trigger={<Button size="sm">Add equipment</Button>}
                  />
                ) : null}
              </div>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Model # / Serial #</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Usual vendor</TableHead>
                  <TableHead className="text-right">Issues</TableHead>
                  <TableHead className="text-right">Paid to date</TableHead>
                  {isAdmin ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeEquipment.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No equipment yet.{isAdmin ? " Add the pieces you want to track, starting with the critical ones." : ""}
                    </TableCell>
                  </TableRow>
                ) : (
                  activeEquipment.map((item) => {
                    const itemIssues = new Set(
                      (allIssuesResult.data ?? []).filter((issue) => issue.equipment_id === item.id).map((issue) => issue.id),
                    );
                    const costs = costSummary((costsResult.data ?? []).filter((event) => itemIssues.has(event.issue_id)));
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Link href={`/dashboard/maintenance/equipment/${item.id}`} className="font-medium hover:underline">
                            {item.name}
                          </Link>
                          {item.is_critical ? (
                            <Badge variant="destructive" className="ml-2">
                              Critical
                            </Badge>
                          ) : null}
                          {item.area ? <p className="text-xs text-muted-foreground">{item.area}</p> : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.model_number ?? "—"}
                          <p className="text-xs text-muted-foreground">{item.serial_number ?? ""}</p>
                        </TableCell>
                        <TableCell>{item.owner_staff_id ? (staffName.get(item.owner_staff_id) ?? "—") : "Club Admins"}</TableCell>
                        <TableCell>{item.default_vendor_id ? (vendorName.get(item.default_vendor_id) ?? "—") : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Link href={`/dashboard/maintenance/equipment/${item.id}`} className="underline">
                            {itemIssues.size}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">{costs.paidCents ? money(costs.paidCents) : "—"}</TableCell>
                        {isAdmin ? (
                          <TableCell className="text-right">
                            <EquipmentDialog
                              staff={staffOptions}
                              vendors={vendors.map((vendor) => ({ id: vendor.id, name: vendor.name, email: vendor.email }))}
                              initial={{
                                id: item.id,
                                name: item.name,
                                area: item.area ?? "",
                                modelNumber: item.model_number ?? "",
                                serialNumber: item.serial_number ?? "",
                                isCritical: item.is_critical,
                                ownerStaffId: item.owner_staff_id ?? "",
                                defaultVendorId: item.default_vendor_id ?? "",
                                notes: item.notes ?? "",
                              }}
                              trigger={
                                <Button size="sm" variant="ghost">
                                  Edit
                                </Button>
                              }
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        ) : null}

        {tab === "vendors" ? (
          <Card className="py-0">
            <CardHeader className="pt-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Vendors</CardTitle>
                  <CardDescription>Contacted by email from a report; replies come back to it. Texting comes later.</CardDescription>
                </div>
                {isAdmin ? <VendorDialog trigger={<Button size="sm">Add vendor</Button>} /> : null}
              </div>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  {isAdmin ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No vendors yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  vendors.map((vendor) => (
                    <TableRow key={vendor.id}>
                      <TableCell className="font-medium">
                        {vendor.name}
                        {vendor.notes ? <p className="text-xs font-normal text-muted-foreground">{vendor.notes}</p> : null}
                      </TableCell>
                      <TableCell>{vendor.contact_name ?? "—"}</TableCell>
                      <TableCell>{vendor.email ?? "—"}</TableCell>
                      <TableCell>{vendor.phone ? formatPhoneForDisplay(vendor.phone) : "—"}</TableCell>
                      {isAdmin ? (
                        <TableCell className="text-right">
                          <VendorDialog
                            initial={{
                              id: vendor.id,
                              name: vendor.name,
                              contactName: vendor.contact_name ?? "",
                              email: vendor.email ?? "",
                              phone: vendor.phone ? formatPhoneForDisplay(vendor.phone) : "",
                              notes: vendor.notes ?? "",
                            }}
                            trigger={
                              <Button size="sm" variant="ghost">
                                Edit
                              </Button>
                            }
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        ) : null}
      </div>
    </DashboardShell>
  );
}
