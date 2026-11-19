import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MindbodyPushBlockedError, pushContactToMindbody, sanitizeMindbodyError } from "@/lib/crm/mindbody-push";

// Member IDs for guests and leads who join through SynqIQ (Adam, 2026-11-19).
// Every member is keyed by their member ID (the Mindbody client id for
// everyone imported). A new member gets one before their membership sale is
// saved, and it must never duplicate an existing one:
// - member_id_source 'mindbody' (now, until SynqIQ billing and sales go live):
//   the guest is added to Mindbody (the CRM push, which links to an existing
//   Mindbody client with the same email/phone instead of duplicating) and
//   Mindbody hands out the next number in its sequence.
// - member_id_source 'synqiq' (after go-live, not switched on): SynqIQ hands
//   out the next number in the same sequence (allocate_member_id). Only once
//   Mindbody no longer creates clients, or numbers could collide.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function ensureMemberId(
  admin: Admin,
  organizationId: string,
  contactId: string,
): Promise<{ clientId: string; created: boolean } | { error: string }> {
  const { data: contact } = await admin
    .from("crm_contacts")
    .select("id, first_name, last_name, email_normalized, mindbody_client_id")
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return { error: "That guest wasn't found." };
  if (contact.mindbody_client_id) return { clientId: contact.mindbody_client_id as string, created: false };

  const { data: org } = await admin.from("organizations").select("member_id_source").eq("id", organizationId).maybeSingle();
  let clientId: string;
  let created = true;
  if (org?.member_id_source === "synqiq") {
    const { data, error } = await admin.rpc("allocate_member_id", { org: organizationId });
    if (error || data == null) return { error: "Couldn't assign a member ID. Try again." };
    clientId = String(data);
  } else {
    try {
      const result = await pushContactToMindbody(admin, contactId, organizationId);
      if ("skipped" in result) return { error: `Couldn't get a member ID from Mindbody: ${result.skipped}.` };
      clientId = result.clientId;
      created = !result.linked;
    } catch (error) {
      if (error instanceof MindbodyPushBlockedError) return { error: `${error.message}. Add it on the guest's profile, then try again.` };
      console.error("[members/ids] Mindbody push failed:", sanitizeMindbodyError(error));
      return { error: "Couldn't reach Mindbody to create the member ID. Try again in a minute." };
    }
  }

  // The guest is now linked to that member ID.
  await admin
    .from("crm_contacts")
    .update({
      mindbody_client_id: clientId,
      mindbody_sync_status: "synced",
      mindbody_synced_at: new Date().toISOString(),
      mindbody_sync_error: null,
    })
    .eq("id", contactId)
    .is("mindbody_client_id", null);
  // A members-list row right away (the nightly sync fills in the rest).
  if (/^\d{1,18}$/.test(clientId)) {
    await admin.from("clients").upsert(
      {
        organization_id: organizationId,
        mindbody_unique_id: Number(clientId),
        mindbody_client_id: clientId,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email_normalized,
        status: "Active",
        is_prospect: false,
      },
      { onConflict: "organization_id,mindbody_unique_id", ignoreDuplicates: true },
    );
  }
  return { clientId, created };
}
