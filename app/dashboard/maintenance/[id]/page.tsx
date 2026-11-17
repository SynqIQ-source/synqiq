import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { costSummary, money, STATUS_LABELS, type IssueStatus } from "@/lib/maintenance/rules";
import { MEDIA_BUCKET, canRunIssue, loadIssue } from "@/lib/maintenance/server";
import { AddMediaButton, IssueActions } from "../maintenance-client";

export const dynamic = "force-dynamic";

const STEPS: IssueStatus[] = [
  "reported",
  "troubleshooting",
  "vendor_contacted",
  "vendor_replied",
  "visit_scheduled",
  "on_site",
  "resolved",
];

const EVENT_LABELS: Record<string, string> = {
  reported: "Reported",
  note: "Note",
  troubleshooting: "Troubleshooting",
  status: "Status",
  vendor_out: "Email to vendor",
  vendor_in: "Vendor replied",
  visit: "Visit scheduled",
  quote: "Quote",
  paid: "Paid",
  resolved: "Resolved",
  reopened: "Reopened",
};

// One maintenance report: what's wrong, photos/video, where it stands, the
// full timeline (notes, troubleshooting, vendor emails both ways, visits,
// quotes and payments), and the actions each person can take.
export default async function MaintenanceIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  const { id } = await params;
  // Read with the service role after the org check in loadIssue (signed
  // media links need it anyway).
  const admin = createSupabaseAdminClient();
  const loaded = await loadIssue(admin, staff.organizationId, id);
  if (!loaded) notFound();
  const { issue, equipment } = loaded;

  const [{ data: org }, { data: events }, { data: media }, { data: vendors }, { data: people }] = await Promise.all([
    admin.from("organizations").select("timezone").eq("id", staff.organizationId).single(),
    admin.from("maintenance_events").select("*").eq("issue_id", issue.id).order("created_at"),
    admin
      .from("maintenance_media")
      .select("id, kind, path, uploaded_by_staff_id")
      .eq("issue_id", issue.id)
      .not("uploaded_at", "is", null)
      .order("created_at"),
    admin.from("maintenance_vendors").select("id, name, email, archived_at").eq("organization_id", staff.organizationId).order("name"),
    admin.from("staff").select("id, display_name").eq("organization_id", staff.organizationId),
  ]);
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const local = (iso: string, format = "LLL d, yyyy h:mm a") => DateTime.fromISO(iso).setZone(zone).toFormat(format);
  const staffName = new Map((people ?? []).map((person) => [person.id as string, person.display_name as string]));
  const vendorName = new Map((vendors ?? []).map((vendor) => [vendor.id as string, vendor.name as string]));
  const links = await Promise.all(
    (media ?? []).map(async (item) => {
      const { data } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(item.path as string, 3600);
      return { id: item.id as string, kind: item.kind as "photo" | "video", url: data?.signedUrl ?? null };
    }),
  );
  const costs = costSummary(events ?? []);
  const status = issue.status;
  const reachedStep = STEPS.indexOf(status);
  const canRun = canRunIssue(staff, equipment);
  const isAdmin = staff.role === "admin";

  return (
    <DashboardShell
      title={issue.title}
      description={`${equipment ? `${equipment.name}${equipment.area ? ` · ${equipment.area}` : ""}` : (issue.location_text ?? "")} · reported ${local(issue.created_at)}${
        issue.reported_by_staff_id ? ` by ${staffName.get(issue.reported_by_staff_id) ?? "staff"}` : ""
      }`}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/maintenance">← Maintenance</Link>
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                {issue.is_critical ? <Badge variant="destructive">Critical</Badge> : null}
                <Badge>{STATUS_LABELS[status]}</Badge>
                {issue.next_visit_at && status !== "resolved" ? (
                  <span className="text-sm">
                    Vendor visit <strong>{local(issue.next_visit_at, "ccc LLL d, h:mm a")}</strong>
                  </span>
                ) : null}
              </div>
              {/* Where it stands: the steps so far. */}
              <ol className="flex flex-wrap gap-1 text-xs">
                {STEPS.map((step, index) => (
                  <li
                    key={step}
                    className={`rounded-full px-2 py-0.5 ${
                      index <= reachedStep ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {STATUS_LABELS[step]}
                  </li>
                ))}
              </ol>
              <p className="text-sm whitespace-pre-wrap">{issue.description}</p>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {equipment ? (
                  <>
                    <Row label="Equipment">
                      <Link href={`/dashboard/maintenance/equipment/${equipment.id}`} className="underline">
                        {equipment.name}
                      </Link>
                    </Row>
                    <Row label="Model #">{equipment.model_number ?? "—"}</Row>
                    <Row label="Serial #">{equipment.serial_number ?? "—"}</Row>
                    <Row label="Owner">{equipment.owner_staff_id ? (staffName.get(equipment.owner_staff_id) ?? "—") : "Club Admins"}</Row>
                  </>
                ) : (
                  <Row label="Where">{issue.location_text ?? "—"}</Row>
                )}
                <Row label="Vendor">{issue.vendor_id ? (vendorName.get(issue.vendor_id) ?? "—") : "Not contacted"}</Row>
                {costs.quotedCents || costs.paidCents ? (
                  <Row label="Quoted / paid">
                    {money(costs.quotedCents)} / {money(costs.paidCents)}
                  </Row>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Photos and video</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {links.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {links.map((item) =>
                    !item.url ? null : item.kind === "video" ? (
                      <video key={item.id} src={item.url} controls playsInline className="aspect-video w-full rounded-md bg-black" />
                    ) : (
                      <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
                        <img src={item.url} alt="Issue photo" className="aspect-square w-full rounded-md object-cover" />
                      </a>
                    ),
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">None yet.</p>
              )}
              {status !== "resolved" ? <AddMediaButton issueId={issue.id} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {(events ?? []).map((event) => (
                  <li key={event.id as string} className="border-l-2 pl-3">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{EVENT_LABELS[event.kind as string] ?? event.kind}</span>
                      {" · "}
                      {local(event.created_at as string)}
                      {event.staff_id ? ` · ${staffName.get(event.staff_id as string) ?? "staff"}` : ""}
                      {event.kind === "vendor_in" ? ` · from ${event.from_email ?? "vendor"}` : ""}
                      {event.kind === "vendor_out" && event.vendor_id
                        ? ` · to ${vendorName.get(event.vendor_id as string) ?? "vendor"}`
                        : ""}
                    </p>
                    {event.kind === "visit" && event.visit_at ? (
                      <p className="text-sm font-medium">Visit {local(event.visit_at as string, "cccc, LLL d 'at' h:mm a")}</p>
                    ) : null}
                    {(event.kind === "quote" || event.kind === "paid") && event.amount_cents != null ? (
                      <p className="text-sm font-medium">{money(event.amount_cents as number)}</p>
                    ) : null}
                    {event.body ? (
                      <p
                        className={`text-sm whitespace-pre-wrap ${event.kind === "vendor_out" ? "max-h-48 overflow-y-auto text-muted-foreground" : ""}`}
                      >
                        {event.body as string}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Update</CardTitle>
          </CardHeader>
          <CardContent>
            <IssueActions
              issueId={issue.id}
              status={status}
              canRun={canRun}
              isAdmin={isAdmin}
              vendors={(vendors ?? [])
                .filter((vendor) => !vendor.archived_at)
                .map((vendor) => ({
                  id: vendor.id as string,
                  name: vendor.name as string,
                  email: (vendor.email as string | null) ?? null,
                }))}
              vendorId={issue.vendor_id ?? equipment?.default_vendor_id ?? null}
              contacted={Boolean(issue.last_message_id)}
            />
            {!canRun ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Scheduling visits and resolving are for the equipment&apos;s owner and Club Admins. You can add notes and troubleshooting.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd>{children}</dd>
    </div>
  );
}
