// Rendered by every app/dashboard/**/loading.tsx as the Suspense fallback
// Next.js swaps in the instant a <Link> navigation starts -- before this,
// none of these routes had a loading.tsx, so clicking a nav link left the
// previous page fully static (no visual feedback at all) until the next
// page's server-side data fetch finished. loading.tsx files can't fetch
// data themselves (they render before that's resolved), so this stays a
// static, synchronous skeleton: same bg-primary-subtle backdrop and fixed
// sidebar-width offset DashboardShell uses, so the swap doesn't flash white
// or jump the layout once the real page mounts.
export function DashboardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-primary-subtle md:pl-64">
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
