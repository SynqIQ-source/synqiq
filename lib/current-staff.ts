import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/permissions";
import { mfaState, sessionCounts, type MfaState } from "@/lib/auth/mfa-policy";

export type CurrentStaff = {
  id: string;
  displayName: string;
  // Access level; see lib/permissions.ts for what each allows.
  role: StaffRole;
  organizationId: string;
  title: string | null;
  photoUrl: string | null;
  // Counts as a salesperson: seller lists, lead assignment, sales credit.
  canSell: boolean;
  // Teaching tags -- combine with any role.
  isInstructor: boolean;
  isTrainer: boolean;
  // Two-step sign-in state (lib/auth/mfa-policy.ts). Never "needs_code":
  // a session that still owes its code is not signed in at all.
  mfa: Exclude<MfaState, "needs_code">;
};

// Wrapped in React's cache() (same pattern as getOrgBranding in
// lib/org-branding.ts) because a single dashboard navigation calls this up
// to 4 times independently -- the root layout (twice: generateViewport and
// the layout body), DashboardShell, and the page itself all resolve their
// own currentStaff. Each call was two sequential round trips
// (auth.getUser() then a staff table lookup) with no dedup, so that was up
// to 8 sequential Supabase calls just to resolve identity before any page
// data loaded. cache() makes repeat calls with no arguments within one
// request resolve to the same in-flight/completed call instead.
export const getCurrentStaff = cache(async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Deliberately the admin client here, not the RLS-scoped server client:
  // no RLS policies exist on `staff` yet (that's the next phase of this
  // auth rollout), so the anon-scoped client would return zero rows
  // regardless of whether the session above is valid. auth.getUser() is
  // Supabase Auth's own mechanism and doesn't depend on Postgres RLS at all
  // -- this lookup is the only thing standing in for "authorization" until
  // RLS policies exist.
  const adminSupabase = createSupabaseAdminClient();
  const { data: staff } = await adminSupabase
    .from("staff")
    .select("id, display_name, role, organization_id, title, photo_url, can_sell, is_instructor, is_trainer")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!staff) {
    return null;
  }

  // Two-step sign-in: a session whose account has an authenticator but
  // hasn't entered this session's code counts as signed out everywhere --
  // every page and API route goes through here. Reads the session's own
  // token; no extra network call.
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfa = mfaState({ role: staff.role, currentLevel: assurance?.currentLevel, nextLevel: assurance?.nextLevel });
  if (!sessionCounts(mfa)) {
    return null;
  }

  return {
    id: staff.id,
    displayName: staff.display_name,
    role: staff.role as StaffRole,
    organizationId: staff.organization_id,
    title: staff.title,
    photoUrl: staff.photo_url,
    canSell: staff.can_sell === true,
    isInstructor: staff.is_instructor === true,
    isTrainer: staff.is_trainer === true,
    mfa: mfa as Exclude<MfaState, "needs_code">,
  };
});
