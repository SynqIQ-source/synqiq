import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { sendPushToStaff } from "@/lib/push/send";

// Assigns (or unassigns, trainerStaffId null) newly enrolled members to a
// trainer for their intro. Admin only. Each change adds a dated note to the
// member's profile, and the trainer gets a push notification.
export async function POST(request: NextRequest) {
  try {
    const staff = await getCrmStaffForApi({ adminOnly: true });
    if (!staff) return jsonError("Not found.", 404);

    const body = await readJsonBody(request);
    const contactIds = Array.isArray(body?.contactIds) ? body.contactIds : null;
    if (!contactIds || contactIds.length === 0 || contactIds.length > 200 || !contactIds.every(isUuid)) {
      return jsonError("Pick at least one member.", 400);
    }
    const trainerStaffId = body?.trainerStaffId ?? null;
    if (trainerStaffId !== null && !isUuid(trainerStaffId)) return jsonError("Pick a trainer.", 400);

    const admin = createSupabaseAdminClient();
    let trainerName: string | null = null;
    if (trainerStaffId) {
      // A trainer must be able to sign in to Synq to see their members.
      const { data: trainer } = await admin
        .from("staff")
        .select("id, display_name")
        .eq("id", trainerStaffId)
        .eq("organization_id", staff.organizationId)
        .is("archived_at", null)
        .not("auth_user_id", "is", null)
        .maybeSingle();
      if (!trainer) return jsonError("That trainer can't sign in to SynqIQ yet.", 404);
      trainerName = trainer.display_name as string;
    }

    const { data: members, error: membersError } = await admin
      .from("crm_contacts")
      .select("id, first_name, last_name, trainer_staff_id")
      .eq("organization_id", staff.organizationId)
      .in("id", contactIds as string[])
      .not("member_enrolled_at", "is", null)
      .is("deleted_at", null)
      .is("merged_into_id", null);
    if (membersError) throw membersError;
    const changing = (members ?? []).filter((member) => member.trainer_staff_id !== trainerStaffId);
    if (changing.length === 0) return NextResponse.json({ success: true, changed: 0 });

    const now = new Date();
    const { error: updateError } = await admin
      .from("crm_contacts")
      .update({
        trainer_staff_id: trainerStaffId,
        trainer_assigned_at: trainerStaffId ? now.toISOString() : null,
        trainer_assigned_by_staff_id: trainerStaffId ? staff.id : null,
        updated_at: now.toISOString(),
      })
      .in(
        "id",
        changing.map((member) => member.id),
      );
    if (updateError) throw updateError;

    const { error: noteError } = await admin.from("crm_notes").insert(
      changing.map((member) => ({
        organization_id: staff.organizationId,
        contact_id: member.id,
        author_staff_id: staff.id,
        body: trainerName
          ? `Assigned to ${trainerName} for their intro workout by ${staff.displayName}.`
          : `Trainer unassigned by ${staff.displayName}.`,
      })),
    );
    if (noteError) throw noteError;

    if (trainerStaffId) {
      const first = changing[0];
      await sendPushToStaff([trainerStaffId], {
        title:
          changing.length === 1
            ? `New member assigned: ${first.first_name} ${first.last_name.charAt(0)}.`
            : `${changing.length} new members assigned to you`,
        body: "Reach out to book their intro workout.",
        url: changing.length === 1 ? `/dashboard/guests/${first.id}` : "/dashboard/follow-up/new-members",
      }).catch((error) => logCrmError("trainer-assignments push", error));
    }

    return NextResponse.json({ success: true, changed: changing.length });
  } catch (error) {
    logCrmError("crm/trainer-assignments POST", error);
    return jsonError("Couldn't save the assignment.", 500);
  }
}
