import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/lib/platform/admin";
import { STUDIO_TIMEZONES } from "@/lib/platform/studios";
import { isModuleKey, listPrice, TEXT_OVERAGE, TEXTS_INCLUDED, type ModuleKey } from "@/lib/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AddStudioButton } from "./add-studio-button";
import { MindbodyActions } from "./mindbody-actions";
import { PlanEditor } from "./plan-editor";

export const dynamic = "force-dynamic";

type Studio = {
  id: string;
  name: string | null;
  timezone: string | null;
  mindbody_site_id: number | null;
  mindbody_connected: boolean;
  mindbody_activation_link: string | null;
  mindbody_activated_at: string | null;
  is_demo: boolean;
  custom_monthly_price: number | null;
  billing_status: string | null;
  stripe_customer_id: string | null;
  created_at: string;
};

// Studios (platform admins only): every organization on SynqIQ, its
// Mindbody connection, and adding a new one. Read with the service client
// because it spans every studio; requirePlatformAdmin is the boundary.
export default async function PlatformStudiosPage() {
  await requirePlatformAdmin();
  const admin = createSupabaseAdminClient();
  const monthStart = DateTime.now().setZone("America/Chicago").startOf("month").toUTC().toISO()!;
  const [studiosResult, staffResult, modulesResult] = await Promise.all([
    admin
      .from("organizations")
      .select(
        "id, name, timezone, mindbody_site_id, mindbody_connected, mindbody_activation_link, mindbody_activated_at, is_demo, custom_monthly_price, billing_status, stripe_customer_id, created_at",
      )
      .order("created_at")
      .returns<Studio[]>(),
    admin.from("staff").select("organization_id, auth_user_id").is("archived_at", null),
    admin.from("org_modules").select("organization_id, module").eq("status", "enabled"),
  ]);
  if (studiosResult.error) throw new Error("Failed to load studios.");
  const studios = studiosResult.data ?? [];
  // Texts sent this month, against each plan's allowance (an exact count,
  // not rows, which would stop at 1,000).
  const texts = new Map<string, number>();
  await Promise.all(
    studios.map(async (studio) => {
      const { count } = await admin
        .from("crm_messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", studio.id)
        .eq("channel", "sms")
        .eq("direction", "outbound")
        .neq("status", "failed")
        .gte("created_at", monthStart);
      texts.set(studio.id, count ?? 0);
    }),
  );
  const logins = new Map<string, number>();
  for (const row of staffResult.data ?? []) {
    if (row.auth_user_id) logins.set(row.organization_id, (logins.get(row.organization_id) ?? 0) + 1);
  }
  const modulesByStudio = new Map<string, ModuleKey[]>();
  for (const row of modulesResult.data ?? []) {
    if (!isModuleKey(row.module)) continue;
    modulesByStudio.set(row.organization_id, [...(modulesByStudio.get(row.organization_id) ?? []), row.module]);
  }
  const zoneLabel = (zone: string | null) => STUDIO_TIMEZONES.find((item) => item.value === zone)?.label ?? zone ?? "—";

  return (
    <DashboardShell
      title="Studios"
      description="Every studio on SynqIQ and its Mindbody connection. Only platform admins see this page."
      actions={<AddStudioButton timezones={[...STUDIO_TIMEZONES]} />}
    >
      <div className="space-y-4">
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Studio</TableHead>
                <TableHead>Time zone</TableHead>
                <TableHead>Logins</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Texts this month</TableHead>
                <TableHead>Mindbody</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {studios.map((studio) => (
                <TableRow key={studio.id}>
                  <TableCell>
                    <p className="font-medium">
                      {studio.name ?? "Unnamed studio"}
                      {studio.is_demo ? (
                        <Badge variant="outline" className="ml-2">
                          Demo
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Added {DateTime.fromISO(studio.created_at).toFormat("LLL d, yyyy")}
                    </p>
                  </TableCell>
                  <TableCell>{zoneLabel(studio.timezone)}</TableCell>
                  <TableCell className="tabular-nums">{logins.get(studio.id) ?? 0}</TableCell>
                  <TableCell className="min-w-72">
                    <p className="mb-1 font-medium tabular-nums">
                      ${studio.custom_monthly_price ?? listPrice(modulesByStudio.get(studio.id) ?? [])}/mo
                      {studio.custom_monthly_price !== null ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">custom</span>
                      ) : null}
                      {studio.billing_status ? (
                        <Badge
                          variant={studio.billing_status === "active" || studio.billing_status === "trialing" ? "secondary" : "destructive"}
                          className="ml-1.5"
                        >
                          {studio.billing_status === "past_due" ? "payment failed" : studio.billing_status.replace("_", " ")}
                        </Badge>
                      ) : studio.custom_monthly_price !== null || studio.is_demo ? null : (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">not billed in Stripe</span>
                      )}
                      {studio.stripe_customer_id ? (
                        <a
                          href={`https://dashboard.stripe.com/customers/${studio.stripe_customer_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1.5 text-xs font-normal text-primary hover:underline"
                        >
                          Stripe
                        </a>
                      ) : null}
                    </p>
                    <PlanEditor
                      studioId={studio.id}
                      modules={modulesByStudio.get(studio.id) ?? []}
                      customPrice={studio.custom_monthly_price === null ? null : Number(studio.custom_monthly_price)}
                    />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {(modulesByStudio.get(studio.id) ?? []).includes("crm") ? (
                      <>
                        {(texts.get(studio.id) ?? 0).toLocaleString()} / {TEXTS_INCLUDED.toLocaleString()}
                        {(texts.get(studio.id) ?? 0) > TEXTS_INCLUDED ? (
                          <span className="block text-xs text-destructive">
                            +${(((texts.get(studio.id) ?? 0) - TEXTS_INCLUDED) * TEXT_OVERAGE).toFixed(2)} over
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {studio.mindbody_site_id === null ? (
                      <span className="text-muted-foreground">{studio.is_demo ? "Made-up data, refreshed nightly" : "No site"}</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="tabular-nums">Site {studio.mindbody_site_id}</span>
                        {studio.mindbody_connected ? (
                          <Badge variant="secondary">Syncing</Badge>
                        ) : studio.mindbody_activated_at ? (
                          <Badge variant="outline">Approved, not syncing</Badge>
                        ) : studio.mindbody_activation_link ? (
                          <Badge variant="outline">Waiting for approval</Badge>
                        ) : (
                          <Badge variant="outline">Not connected</Badge>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {studio.mindbody_site_id !== null ? (
                      <MindbodyActions
                        studioId={studio.id}
                        studioName={studio.name ?? "this studio"}
                        connected={studio.mindbody_connected}
                        link={studio.mindbody_activation_link}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <p className="text-xs text-muted-foreground">
          To connect a studio: get its Mindbody approval link and send it to the owner. After they approve SynqIQ in
          Mindbody, check approval, then start syncing. Syncing runs every night and only for studios marked Syncing.
        </p>
      </div>
    </DashboardShell>
  );
}
