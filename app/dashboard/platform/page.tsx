import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/lib/platform/admin";
import { STUDIO_TIMEZONES } from "@/lib/platform/studios";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AddStudioButton } from "./add-studio-button";
import { MindbodyActions } from "./mindbody-actions";

export const dynamic = "force-dynamic";

type Studio = {
  id: string;
  name: string | null;
  timezone: string | null;
  mindbody_site_id: number | null;
  mindbody_connected: boolean;
  mindbody_activation_link: string | null;
  mindbody_activated_at: string | null;
  created_at: string;
};

// Studios (platform admins only): every organization on SynqIQ, its
// Mindbody connection, and adding a new one. Read with the service client
// because it spans every studio; requirePlatformAdmin is the boundary.
export default async function PlatformStudiosPage() {
  await requirePlatformAdmin();
  const admin = createSupabaseAdminClient();
  const [studiosResult, staffResult, modulesResult] = await Promise.all([
    admin
      .from("organizations")
      .select(
        "id, name, timezone, mindbody_site_id, mindbody_connected, mindbody_activation_link, mindbody_activated_at, created_at",
      )
      .order("created_at")
      .returns<Studio[]>(),
    admin.from("staff").select("organization_id, auth_user_id").is("archived_at", null),
    admin.from("org_modules").select("organization_id, module").eq("status", "enabled"),
  ]);
  if (studiosResult.error) throw new Error("Failed to load studios.");
  const studios = studiosResult.data ?? [];
  const logins = new Map<string, number>();
  for (const row of staffResult.data ?? []) {
    if (row.auth_user_id) logins.set(row.organization_id, (logins.get(row.organization_id) ?? 0) + 1);
  }
  const crm = new Set((modulesResult.data ?? []).filter((row) => row.module === "crm").map((row) => row.organization_id));
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
                <TableHead>Mindbody</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {studios.map((studio) => (
                <TableRow key={studio.id}>
                  <TableCell>
                    <p className="font-medium">{studio.name ?? "Unnamed studio"}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {DateTime.fromISO(studio.created_at).toFormat("LLL d, yyyy")}
                      {crm.has(studio.id) ? " · CRM" : ""}
                    </p>
                  </TableCell>
                  <TableCell>{zoneLabel(studio.timezone)}</TableCell>
                  <TableCell className="tabular-nums">{logins.get(studio.id) ?? 0}</TableCell>
                  <TableCell>
                    {studio.mindbody_site_id === null ? (
                      <span className="text-muted-foreground">No site</span>
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
