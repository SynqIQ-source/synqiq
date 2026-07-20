import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// For Realtime specifically: @supabase/ssr's browser client reads the
// session from cookies asynchronously, and the Realtime websocket can
// connect before that resolves -- it then authenticates as anon, silently.
// The channel still reaches "SUBSCRIBED" (channel join doesn't require a
// valid user token) and Realtime's own server confirms "Subscribed to
// PostgreSQL", so nothing about the subscribe call looks wrong -- but
// every event then gets evaluated against RLS as anon and gets dropped,
// with no error anywhere. Confirmed empirically: identical table/RLS/
// filter reliably delivers events when the client's session is set
// explicitly (supabase.auth.setSession with a known token) and reliably
// does not when relying on the browser client's own cookie-based session
// hydration for a fresh subscribe. Explicitly resolving the session and
// calling realtime.setAuth() before subscribing closes that race -- this
// is the client any code doing postgres_changes should use, not the plain
// createSupabaseBrowserClient() above.
export async function createRealtimeAuthedBrowserClient() {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    supabase.realtime.setAuth(session.access_token);
  }

  return supabase;
}
