import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";

// Standard Supabase SSR pattern: refreshes the session cookie on every
// request so Server Components always see an up-to-date session instead of
// a stale/expired one. Server Components can't set cookies themselves (only
// middleware, Route Handlers, and Server Actions can) -- without this,
// sessions would silently go stale on navigation.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const setAll: SetAllCookies = (cookiesToSet) => {
    cookiesToSet.forEach(({ name, value }) => {
      request.cookies.set(name, value);
    });
    response = NextResponse.next({ request });
    cookiesToSet.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
  };

  const supabase = createServerClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll,
      },
    },
  );

  // Calling getUser() (not getSession()) is what actually triggers the
  // token refresh against Supabase Auth -- getSession() alone just reads
  // the existing cookie without validating/refreshing it.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
