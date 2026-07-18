import type { CurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real session -> the RLS-scoped client, so Postgres policies are the
// actual enforcement. Callers doing writes should derive identity from
// currentStaff.id at that point, not trust any client-supplied field --
// that's the whole point of moving off the admin client.
//
// No session (the ~137 staff without a login yet, using the "select your
// name" dropdown) -> the admin client, exactly like every route already
// behaves today. This is the same trust level as before, not a regression:
// there's no way for a session-less caller to pass RLS at all, so falling
// back here just preserves current behavior until they're provisioned.
//
// Deliberately NOT used for two things: the identity-resolution queries in
// lib/current-staff.ts (bootstrapping identity can't depend on already
// knowing it), and any route performing an admin-only action -- those
// should require a real session outright rather than silently falling back
// to the admin client for an unauthenticated caller.
export async function getScopedClient(currentStaff: CurrentStaff | null) {
  if (currentStaff) {
    return createSupabaseServerClient();
  }

  return createSupabaseAdminClient();
}

export type ScopedSupabaseClient = Awaited<ReturnType<typeof getScopedClient>>;
