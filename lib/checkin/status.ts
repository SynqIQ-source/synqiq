import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { toDate } from "@/lib/memberships/contracts";
import type { MindbodyClientService } from "@/lib/memberships/profile";
import { decideCheckIn, type CheckInDecision, type ServiceInfo } from "@/lib/checkin/eligibility";

// Everything the front desk needs to check someone in: who they are, what
// covers the visit (live from Mindbody's services, falling back to SynqIQ's
// copy), and warnings. Read with the service role; callers check the role.

export type CheckInStatus = {
  client: { mindbodyClientId: string; name: string; status: string | null; photoUrl: string | null; email: string | null };
  decision: CheckInDecision;
  servicesFrom: "mindbody" | "synqiq";
  services: ServiceInfo[];
  today: string;
  lastCheckIn: string | null;
};

export async function loadCheckInStatus(organizationId: string, mindbodyClientId: string): Promise<CheckInStatus | null> {
  const admin = createSupabaseAdminClient();
  const [{ data: org }, { data: client }] = await Promise.all([
    admin.from("organizations").select("timezone, mindbody_site_id").eq("id", organizationId).maybeSingle(),
    admin
      .from("clients")
      .select("mindbody_client_id, first_name, last_name, email, status")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", mindbodyClientId)
      .maybeSingle(),
  ]);
  if (!client) return null;
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone).toISODate()!;

  // Services: live from Mindbody, else SynqIQ's last copy.
  let services: ServiceInfo[] = [];
  let servicesFrom: CheckInStatus["servicesFrom"] = "synqiq";
  if (org?.mindbody_site_id) {
    try {
      const mindbody = createMindbodyClient({ siteId: String(org.mindbody_site_id) });
      const token = await mindbody.requireAccessToken();
      const response = (await mindbody.getClientServices(mindbodyClientId, 0, token)) as { ClientServices?: MindbodyClientService[] };
      services = (response.ClientServices ?? []).map((service) => ({
        id: service.Id,
        name: (service.Name ?? "").trim(),
        program: service.Program?.Name ?? null,
        count: typeof service.Count === "number" ? service.Count : null,
        remaining: typeof service.Remaining === "number" ? service.Remaining : null,
        activeDate: toDate(service.ActiveDate),
        expirationDate: toDate(service.ExpirationDate),
        current: service.Current ?? null,
      }));
      servicesFrom = "mindbody";
    } catch (error) {
      console.error("[check-in] live services failed:", error instanceof Error ? error.message : error);
    }
  }
  if (servicesFrom === "synqiq") {
    const { data } = await admin
      .from("member_services")
      .select("mindbody_client_service_id, name, program, count, remaining, active_date, expiration_date, is_current")
      .eq("organization_id", organizationId)
      .eq("mindbody_client_id", mindbodyClientId);
    services = (data ?? []).map((row) => ({
      id: Number(row.mindbody_client_service_id),
      name: row.name as string,
      program: (row.program as string | null) ?? null,
      count: (row.count as number | null) ?? null,
      remaining: (row.remaining as number | null) ?? null,
      activeDate: (row.active_date as string | null) ?? null,
      expirationDate: (row.expiration_date as string | null) ?? null,
      current: (row.is_current as boolean | null) ?? null,
    }));
  }

  const [{ data: programs }, { data: contracts }, { data: edits }, { data: todays }, { data: last }, { data: personal }] =
    await Promise.all([
      admin.from("departments").select("name").eq("organization_id", organizationId).eq("schedule_type", "Arrival"),
      admin
        .from("member_contracts")
        .select("id, contract_name, start_date, end_date, autopay_status")
        .eq("organization_id", organizationId)
        .eq("mindbody_client_id", mindbodyClientId),
      admin
        .from("billing_adjustments")
        .select("kind, starts_on, ends_on")
        .eq("organization_id", organizationId)
        .eq("mindbody_client_id", mindbodyClientId)
        .in("kind", ["freeze", "cancel"])
        .is("cancelled_at", null),
      admin
        .from("check_ins")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("mindbody_client_id", mindbodyClientId)
        .eq("local_date", today)
        .is("voided_at", null)
        .limit(1),
      admin
        .from("check_ins")
        .select("checked_in_at")
        .eq("organization_id", organizationId)
        .eq("mindbody_client_id", mindbodyClientId)
        .is("voided_at", null)
        .order("checked_in_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("member_personal")
        .select("mindbody, edits")
        .eq("organization_id", organizationId)
        .eq("mindbody_client_id", mindbodyClientId)
        .maybeSingle(),
    ]);

  const decision = decideCheckIn({
    today,
    services,
    arrivalPrograms: (programs ?? []).map((row) => row.name as string),
    contracts: (contracts ?? []).map((row) => ({
      id: row.id as string,
      name: row.contract_name as string,
      startDate: (row.start_date as string | null) ?? null,
      endDate: (row.end_date as string | null) ?? null,
      autopayStatus: (row.autopay_status as string | null) ?? null,
    })),
    synqiqEdits: (edits ?? []).map((row) => ({
      kind: row.kind as "freeze" | "cancel",
      startsOn: row.starts_on as string,
      endsOn: (row.ends_on as string | null) ?? null,
    })),
    clientStatus: (client.status as string | null) ?? null,
    alreadyCheckedInToday: Boolean(todays?.length),
  });

  const photo = (personal?.mindbody as { photoUrl?: string | null } | null)?.photoUrl ?? null;
  const editedEmail = (personal?.edits as { email?: string | null } | null)?.email;
  return {
    client: {
      mindbodyClientId,
      name: `${client.first_name} ${client.last_name}`.trim(),
      status: (client.status as string | null) ?? null,
      photoUrl: photo,
      email: editedEmail !== undefined ? editedEmail : ((client.email as string | null) ?? null),
    },
    decision,
    servicesFrom,
    services,
    today,
    lastCheckIn: (last?.checked_in_at as string | undefined) ?? null,
  };
}
