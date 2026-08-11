// Shared by the desktop sidebar (components/sidebar-nav.tsx) and the mobile
// bottom nav (components/bottom-nav.tsx) so "what counts as the active tab"
// can't drift between the two.
export function isActiveNavHref(pathname: string, href: string) {
  // Exact match for "/dashboard" itself (Overview) -- otherwise every other
  // /dashboard/* page would also match its prefix. Prefix match for
  // everything else so a nested route (e.g. a future /dashboard/classes/[id])
  // still highlights the right tab.
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
