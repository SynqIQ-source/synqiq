// Shown when a request has a valid Supabase Auth session (middleware
// already guarantees that for anything under /dashboard/*) but no staff
// row is linked to it -- an orphaned/unprovisioned account, not an
// unauthenticated visitor. "Sign in" would be the wrong call to action
// here since they already are signed in; the real fix is provisioning,
// which only an admin can do.
export function StaffNotProvisioned() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6">
      <h2 className="text-base font-semibold text-zinc-950">Account not set up</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        You&apos;re signed in, but your account isn&apos;t linked to a staff profile yet.
        Contact an admin to get set up.
      </p>
    </section>
  );
}
