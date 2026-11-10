import { redirect } from "next/navigation";
import { getCurrentStaff, type CurrentStaff } from "@/lib/current-staff";
import { homePath } from "@/lib/permissions";

// Page guard: signed-in staff who pass `allowed`; anyone else is sent to
// their own home page (sign-in when there's no session).
export async function requireAccess(allowed: (staff: CurrentStaff) => boolean): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  // Only when two-step sign-in is required for Club Admins
  // (REQUIRE_FOR_CLUB_ADMINS) and not set up yet.
  if (staff.mfa === "setup_required") redirect("/dashboard/account?setup=two-step#two-step");
  if (!allowed(staff)) redirect(homePath(staff));
  return staff;
}
