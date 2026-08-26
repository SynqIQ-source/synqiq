import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

// Node's fetch has no default timeout -- a stalled connection would
// otherwise hang whatever sync script is awaiting it forever instead of
// failing into a retry. Confirmed happening during the class-visits
// backfill (same underlying issue as the MindBody client's own timeout fix
// in lib/mindbody/client.ts, just on the Supabase side of that same sync).
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
}

export function createSupabaseAdminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: fetchWithTimeout,
      },
    },
  );
}
