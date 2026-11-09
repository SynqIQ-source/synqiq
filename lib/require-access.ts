import { redirect } from "next/navigation";
import { getCurrentStaff, type CurrentStaff } from "@/lib/current-staff";
import { homePath } from "@/lib/permissions";

// Page guard: signed-in staff who pass `allowed`; anyone else is sent to
// their own home page (sign-in when there's no session).
export async function requireAccess(allowed: (staff: CurrentStaff) => boolean): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (!allowed(staff)) redirect(homePath(staff));
  return staff;
}
