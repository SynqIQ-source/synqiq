import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  // Server Components can't set cookies -- only Route Handlers, Server
  // Actions and middleware can. When a page outside /dashboard (which the
  // middleware doesn't cover) renders with an expired session, Supabase tries
  // to refresh or clear the cookie here and Next throws, crashing the page.
  // Supabase's documented pattern is to ignore that: the middleware (or the
  // next Route Handler) writes the refreshed cookie instead.
  const setAll: SetAllCookies = (cookiesToSet) => {
    try {
      cookiesToSet.forEach(({ name, value, options }) => {
        cookieStore.set(name, value, options);
      });
    } catch {
      // Called from a Server Component; safe to ignore (see above).
    }
  };

  return createServerClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll,
      },
    },
  );
}
