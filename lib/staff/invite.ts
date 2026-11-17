import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// Sends a SynqIQ login invite (Supabase invite email: a link to set their
// password) and links the new login to the staff row. Used when a Club Admin
// adds an employee; /api/staff/[id]/invite does the same for existing staff.
export async function sendStaffInvite(admin: Admin, input: { staffId: string; email: string; origin: string }) {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, { redirectTo: `${input.origin}/auth/confirm` });
  if (error || !data?.user) {
    const alreadyRegistered = /already been registered|already registered|email address is already/i.test(error?.message ?? "");
    return {
      ok: false as const,
      error: alreadyRegistered
        ? `${input.email} already has a SynqIQ account. Use "Send password reset" for them instead.`
        : (error?.message ?? "Failed to send the invite."),
    };
  }
  const { error: linkError } = await admin.from("staff").update({ auth_user_id: data.user.id, email: input.email }).eq("id", input.staffId);
  if (linkError) return { ok: false as const, error: linkError.message };
  return { ok: true as const };
}
