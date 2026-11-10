// Two-step sign-in (Supabase Auth MFA, authenticator-app codes) policy.
// Pure so it can be unit-tested; the session's assurance levels come from
// supabase.auth.mfa.getAuthenticatorAssuranceLevel():
//   currentLevel "aal2" = this session already entered a code
//   nextLevel    "aal2" = the account has a verified authenticator
//
// - Anyone with an authenticator must enter a code before the session counts
//   as signed in (getCurrentStaff returns null until then, which protects
//   every page and API route, Club Admin ones included).
// - Club Admins without one are asked to set it up (a banner today).
//   REQUIRE_FOR_CLUB_ADMINS turns that into a hard requirement; switch it on
//   before member payments go live.
export const REQUIRE_FOR_CLUB_ADMINS = false;

// Supabase types this as a string; only "aal2" matters here.
export type AssuranceLevel = string | null | undefined;

export type MfaState = "ok" | "needs_code" | "setup_recommended" | "setup_required";

export function mfaState(input: {
  role: string | null | undefined;
  currentLevel: AssuranceLevel;
  nextLevel: AssuranceLevel;
  requireForClubAdmins?: boolean;
}): MfaState {
  const enrolled = input.nextLevel === "aal2";
  if (enrolled && input.currentLevel !== "aal2") return "needs_code";
  if (!enrolled && input.role === "admin") {
    return (input.requireForClubAdmins ?? REQUIRE_FOR_CLUB_ADMINS) ? "setup_required" : "setup_recommended";
  }
  return "ok";
}

// Whether the session may be treated as signed in at all.
export function sessionCounts(state: MfaState): boolean {
  return state !== "needs_code";
}
