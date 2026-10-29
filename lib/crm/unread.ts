import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CurrentStaff } from "@/lib/current-staff";

// Unread guest messages (inbound, not yet opened) for the nav badge: every
// unread message in the studio for admins; for sellers, only messages from
// guests assigned to them; for trainers, only from members assigned to them.
export const unreadGuestMessageCount = cache(async function unreadGuestMessageCount(
  staff: CurrentStaff,
): Promise<number> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("crm_messages")
    .select("id, contact:crm_contacts!inner ( assigned_staff_id, trainer_staff_id, deleted_at )", {
      count: "exact",
      head: true,
    })
    .eq("organization_id", staff.organizationId)
    .eq("direction", "inbound")
    .is("read_at", null)
    .is("contact.deleted_at", null);
  if (staff.role !== "admin") {
    query = staff.canSell
      ? query.or(`assigned_staff_id.eq.${staff.id},trainer_staff_id.eq.${staff.id}`, { referencedTable: "contact" })
      : query.eq("contact.trainer_staff_id", staff.id);
  }
  const { count } = await query;
  return count ?? 0;
});
