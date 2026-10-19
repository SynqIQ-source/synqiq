import Link from "next/link";
import { getCurrentStaff } from "@/lib/current-staff";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { BottomNav, type NavItem } from "@/components/bottom-nav";
import { SidebarNav, type NavGroup } from "@/components/sidebar-nav";
import { AccountMenu } from "@/components/account-menu";

type NavEntry = NavItem & { adminOnly: boolean };

// Grouped so the sidebar reads as "what I do every day" / "how the studio is
// doing" / "setup", instead of one flat list of 16 links.
//
// adminOnly is a nav-visibility simplification, not an access-control
// boundary -- none of these pages check role themselves, so hiding a link
// doesn't change what a direct URL visit can reach. Real access control
// (where it exists) lives in RLS/route handlers, same as everywhere else in
// this app.
const navigation: { label: string | null; items: NavEntry[] }[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Overview", adminOnly: true }],
  },
  {
    label: "Teaching",
    items: [
      { href: "/dashboard/schedule", label: "My Schedule", adminOnly: false },
      { href: "/dashboard/classes", label: "Classes", adminOnly: false },
      { href: "/dashboard/sub-requests", label: "Sub Requests", adminOnly: false },
      { href: "/dashboard/follow-up", label: "Follow Up", adminOnly: false },
      { href: "/dashboard/messages", label: "Message Boards", adminOnly: false },
      { href: "/dashboard/notifications", label: "Notifications", adminOnly: false },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/dashboard/heatmap", label: "Heat Map", adminOnly: true },
      { href: "/dashboard/instructors", label: "Instructors", adminOnly: true },
      { href: "/dashboard/trainer-health", label: "Trainer Health", adminOnly: true },
      { href: "/dashboard/substitutions", label: "Substitutions", adminOnly: true },
      { href: "/dashboard/follow-up-activity", label: "Follow-ups", adminOnly: true },
      { href: "/dashboard/comp-audit", label: "Comp Audit", adminOnly: true },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/dashboard/settings", label: "Settings", adminOnly: true },
      { href: "/dashboard/settings/staff", label: "Staff Logins", adminOnly: true },
      { href: "/dashboard/settings/eligibility", label: "Class Eligibility", adminOnly: true },
      { href: "/dashboard/settings/imports", label: "Imports", adminOnly: true },
    ],
  },
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
  // Optional controls rendered on the right of the page header (filters,
  // time-frame pickers, primary actions).
  actions?: React.ReactNode;
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
      <span className="text-base font-semibold tracking-tight text-foreground">SynqIQ</span>
    </Link>
  );
}

export async function DashboardShell({ children, title, description, actions }: DashboardShellProps) {
  // Self-resolved rather than threaded through as a prop, matching this
  // app's convention of each component resolving what it needs
  // independently; getCurrentStaff() is React-cache()d per request.
  // No session (dropdown mode) is treated as instructor-level nav.
  const currentStaff = await getCurrentStaff();
  const isAdmin = currentStaff?.role === "admin";

  const visibleGroups: NavGroup[] = navigation
    .map((group) => ({
      label: group.label,
      items: group.items
        .filter((item) => !item.adminOnly || isAdmin)
        .map(({ href, label }) => ({ href, label })),
    }))
    .filter((group) => group.items.length > 0);

  const visibleItems = visibleGroups.flatMap((group) => group.items);
  const primaryMobileItems = PRIMARY_MOBILE_HREFS.map((href) =>
    visibleItems.find((item) => item.href === href),
  ).filter((item): item is NavItem => Boolean(item));
  const moreMobileItems = visibleItems.filter((item) => !PRIMARY_MOBILE_HREFS.includes(item.href));

  return (
    <div className="min-h-screen bg-background">
      <ServiceWorkerRegister />

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-card md:flex">
        <div className="flex h-16 items-center px-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <SidebarNav groups={visibleGroups} />
        </div>
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <div className="mb-3 md:hidden">
                <Logo />
              </div>
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
              <p className="mt-0.5 line-clamp-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {actions}
              {currentStaff ? (
                <AccountMenu
                  displayName={currentStaff.displayName}
                  role={currentStaff.role}
                  title={currentStaff.title}
                  photoUrl={currentStaff.photoUrl}
                />
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6 md:pb-10">{children}</main>
      </div>

      <BottomNav primaryItems={primaryMobileItems} moreItems={moreMobileItems} />
    </div>
  );
}
