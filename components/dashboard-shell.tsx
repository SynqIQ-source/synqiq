import Link from "next/link";
import { getCurrentStaff } from "@/lib/current-staff";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { BottomNav } from "@/components/bottom-nav";

// adminOnly is a nav-visibility simplification, not an access-control
// boundary -- none of these pages check role themselves, so hiding a link
// doesn't change what a direct URL visit can reach. Real access control
// (where it exists) lives in RLS/route handlers, same as everywhere else in
// this app.
const navigation = [
  { href: "/dashboard", label: "Overview", adminOnly: true },
  { href: "/dashboard/classes", label: "Classes", adminOnly: false },
  { href: "/dashboard/schedule", label: "My Schedule", adminOnly: false },
  { href: "/dashboard/sub-requests", label: "Sub Requests", adminOnly: false },
  { href: "/dashboard/messages", label: "Message Boards", adminOnly: false },
  { href: "/dashboard/notifications", label: "Notifications", adminOnly: false },
  { href: "/dashboard/heatmap", label: "Heat Map", adminOnly: true },
  { href: "/dashboard/instructors", label: "Instructors", adminOnly: true },
  { href: "/dashboard/trainer-health", label: "Trainer Health", adminOnly: true },
  { href: "/dashboard/substitutions", label: "Substitutions", adminOnly: true },
  { href: "/dashboard/settings", label: "Settings", adminOnly: true },
  { href: "/dashboard/settings/imports", label: "Imports", adminOnly: true },
  { href: "/dashboard/comp-audit", label: "Comp Audit", adminOnly: true },
];

// Fixed, identical across roles -- solves the mobile bottom-bar width
// problem uniformly (every role gets the same 4-tab-plus-More bar) instead
// of admin getting a wider bar than instructors. Everything else lands in
// the "More" popover, filtered by the same adminOnly rule as the desktop
// sidebar -- nothing becomes unreachable on mobile, just not primary.
const PRIMARY_MOBILE_HREFS = [
  "/dashboard/classes",
  "/dashboard/schedule",
  "/dashboard/sub-requests",
  "/dashboard/messages",
];

type DashboardShellProps = {
  children: React.ReactNode;
  title: string;
  description: string;
};

export async function DashboardShell({
  children,
  title,
  description,
}: DashboardShellProps) {
  // Self-resolved rather than threaded through as a prop, matching this
  // app's existing convention of each component resolving what it needs
  // independently (no shared layout/context) -- costs a second
  // getCurrentStaff() call per page load alongside the one every page
  // already makes for its own purposes, which is an acceptable, consistent
  // tradeoff given the alternative is a new prop on all 9 existing callers.
  // No session (dropdown mode) is treated as instructor-level nav.
  const currentStaff = await getCurrentStaff();
  const isAdmin = currentStaff?.role === "admin";
  const visibleNavigation = navigation.filter((item) => !item.adminOnly || isAdmin);
  const primaryMobileItems = visibleNavigation.filter((item) =>
    PRIMARY_MOBILE_HREFS.includes(item.href),
  );
  const moreMobileItems = visibleNavigation.filter(
    (item) => !PRIMARY_MOBILE_HREFS.includes(item.href),
  );

  return (
    <div className="min-h-screen bg-zinc-50">
      <ServiceWorkerRegister />
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-zinc-200 bg-white px-5 py-6 md:block">
        <Link href="/" className="text-xl font-semibold text-zinc-950">
          Synq
        </Link>
        <nav className="mt-8 flex flex-col gap-1">
          {visibleNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="md:pl-64">
        <header className="border-b border-zinc-200 bg-white px-6 py-5">
          <div className="mx-auto max-w-6xl">
            <div className="mb-4 md:hidden">
              <Link href="/" className="text-xl font-semibold text-zinc-950">
                Synq
              </Link>
            </div>
            <p className="text-sm font-medium text-primary">Dashboard</p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-950">
              {title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              {description}
            </p>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 pt-8 pb-24 md:pb-8">{children}</main>
      </div>
      <BottomNav primaryItems={primaryMobileItems} moreItems={moreMobileItems} />
    </div>
  );
}
