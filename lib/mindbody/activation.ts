import { DateTime } from "luxon";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Connecting a studio's Mindbody site (platform admins only):
//
//   1. Get the site's activation link and send it to the studio owner.
//   2. The owner opens it in Mindbody and approves Synq.
//   3. Check: an approved site appears in GET /site/sites for our API key.
//   4. Connect: the nightly syncs start running for it (lib/sync/sites.ts).
//
// Steps 1 and 3 only read from Mindbody. Step 4 is a deliberate, separate
// action, because it starts writing that studio's data.

export type ActivationStatus = {
  siteId: number;
  link: string | null;
  code: string | null;
  approved: boolean;
  siteName: string | null;
  connected: boolean;
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function loadOrg(admin: AdminClient, organizationId: string) {
  const { data, error } = await admin
    .from("organizations")
    .select("id, mindbody_site_id, mindbody_connected, mindbody_activation_code, mindbody_activation_link, mindbody_activated_at")
    .eq("id", organizationId)
    .single();
  if (error) throw error;
  if (data.mindbody_site_id === null || data.mindbody_site_id === undefined) {
    throw new Error("Set the studio's Mindbody site ID first.");
  }
  return data;
}

// Step 1: fetch (and store) the activation code and link for the studio's site.
export async function requestActivationLink(organizationId: string): Promise<{ code: string; link: string }> {
  const admin = createSupabaseAdminClient();
  const org = await loadOrg(admin, organizationId);
  const result = await createMindbodyClient({ siteId: String(org.mindbody_site_id) }).getActivationCode();
  if (!result.ActivationLink || !result.ActivationCode) {
    throw new Error("Mindbody didn't return an activation link for that site ID.");
  }
  const { error } = await admin
    .from("organizations")
    .update({ mindbody_activation_code: result.ActivationCode, mindbody_activation_link: result.ActivationLink })
    .eq("id", organizationId);
  if (error) throw error;
  return { code: result.ActivationCode, link: result.ActivationLink };
}

// Step 3: has the owner approved Synq? Records when it was first seen approved.
export async function checkActivation(organizationId: string): Promise<ActivationStatus> {
  const admin = createSupabaseAdminClient();
  const org = await loadOrg(admin, organizationId);
  const siteId = Number(org.mindbody_site_id);
  const sites = ((await createMindbodyClient({ siteId: String(siteId) }).getSite())?.Sites ?? []) as {
    Id: number;
    Name: string;
  }[];
  const site = sites.find((candidate) => candidate.Id === siteId) ?? null;
  const now = DateTime.utc().toISO();
  const { error } = await admin
    .from("organizations")
    .update({
      mindbody_activation_checked_at: now,
      ...(site && !org.mindbody_activated_at ? { mindbody_activated_at: now } : {}),
    })
    .eq("id", organizationId);
  if (error) throw error;
  return {
    siteId,
    link: org.mindbody_activation_link,
    code: org.mindbody_activation_code,
    approved: Boolean(site),
    siteName: site?.Name ?? null,
    connected: org.mindbody_connected === true,
  };
}

// Step 4: start (or stop) the nightly syncs for this studio. Connecting needs
// the site approved; disconnecting just stops future syncs and keeps data.
export async function setMindbodyConnected(organizationId: string, connected: boolean): Promise<ActivationStatus> {
  const status = await checkActivation(organizationId);
  if (connected && !status.approved) {
    throw new Error("The studio hasn't approved Synq in Mindbody yet. Send them the activation link first.");
  }
  const { error } = await createSupabaseAdminClient()
    .from("organizations")
    .update({ mindbody_connected: connected })
    .eq("id", organizationId);
  if (error) throw error;
  return { ...status, connected };
}
