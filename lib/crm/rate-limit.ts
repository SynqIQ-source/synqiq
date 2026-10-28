import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Fixed-window rate limit backed by Postgres (public.crm_rate_limit_hit, service
// role only). Keys must never contain personal data: callers hash any
// email/phone before passing it in. Fails closed on a database error.
export async function rateLimit(key: string, windowSeconds: number, limit: number): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("crm_rate_limit_hit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_limit: limit,
  });
  if (error) {
    console.error("[rateLimit] check failed:", error.message);
    return false;
  }
  return data === true;
}

// Every listed window must allow the request.
export async function rateLimitAll(checks: { key: string; windowSeconds: number; limit: number }[]): Promise<boolean> {
  for (const check of checks) {
    if (!(await rateLimit(check.key, check.windowSeconds, check.limit))) {
      return false;
    }
  }
  return true;
}
