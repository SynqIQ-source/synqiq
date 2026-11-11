import Link from "next/link";
import { getEnabledModules } from "@/lib/modules";
import type { ModuleKey } from "@/lib/plans";
import { getPlatformAdmin } from "@/lib/platform/admin";
import { getCurrentStaff } from "@/lib/current-staff";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { BottomNav, type NavItem } from "@/components/bottom-nav";
import { SidebarNav, type NavGroup } from "@/components/sidebar-nav";
import { AccountMenu } from "@/components/account-menu";
import { isCrmEnabled } from "@/lib/crm/module";
import type { CurrentStaff } from "@/lib/current-staff";
import {
  canUseCrm,
  canViewOverview,
  isClubAdmin,
  isInstructorAccess,
  canCheckIn,
  isTrainerAccess,
} from "@/lib/permissions";
import { unreadGuestMessageCount } from "@/lib/crm/unread";

// who: which staff see the link (lib/permissions.ts); omitted = everyone.
// The pages enforce the same rule themselves -- hiding a link is not the
// access control.
// crm: shown only when the org has the CRM module.
// platform: shown only to SynqIQ platform admins (lib/platform/admin.ts).
// modules: shown only when the studio has at least one of these modules on.
type NavEntry = NavItem & {
  who?: (staff: CurrentStaff) => boolean;
  crm?: boolean;
  platform?: boolean;
  modules?: ModuleKey[];
};

const instructorOrTrainer = (staff: CurrentStaff) => isInstructorAccess(staff) || isTrainerAccess(staff);

// Grouped so the sidebar reads as "what I do every day" / "how the studio is
// doing" / "setup", instead of one flat list of 16 links.
const navigation: { label: string | null; items: NavEntry[] }[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Overview", who: canViewOverview }],
  },
  {
    label: "Teaching",
    items: [
      { href: "/dashboard/schedule", label: "My Schedule", who: isInstructorAccess, modules: ["group_fitness"] },
      { href: "/dashboard/classes", label: "Classes", modules: ["group_fitness"] },
      { href: "/dashboard/sub-requests", label: "Sub Requests", who: isInstructorAccess, modules: ["group_fitness"] },
      { href: "/dashboard/follow-up", label: "Follow Up", who: instructorOrTrainer, modules: ["group_fitness", "trainer"] },
      { href: "/dashboard/messages", label: "Message Boards" },
      { href: "/dashboard/notifications", label: "Notifications" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/dashboard/check-in", label: "Check-in", who: canCheckIn },
      { href: "/dashboard/sales", label: "Sales Dashboard", who: canUseCrm, crm: true },
      { href: "/dashboard/sales/history", label: "Sales History", who: canUseCrm, crm: true },
      { href: "/dashboard/guests", label: "Guests", who: canUseCrm, crm: true },
      { href: "/dashboard/sales/calendar", label: "Calendar", who: canUseCrm, crm: true },
      { href: "/dashboard/sales/lead-status", label: "Lead Status", who: canUseCrm, crm: true },
      { href: "/dashboard/sales/follow-ups", label: "Lead Follow-ups", who: canUseCrm, crm: true },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/dashboard/heatmap", label: "Heat Map", who: isClubAdmin, modules: ["group_fitness"] },
      { href: "/dashboard/instructors", label: "Instructors", who: isClubAdmin, modules: ["group_fitness"] },
      { href: "/dashboard/trainer-health", label: "Trainer Health", who: isTrainerAccess, modules: ["trainer"] },
      { href: "/dashboard/sales/new-members", label: "New Members", who: isTrainerAccess, modules: ["trainer"] },
      { href: "/dashboard/substitutions", label: "Substitutions", who: isClubAdmin, modules: ["group_fitness"] },
      { href: "/dashboard/follow-up-activity", label: "Follow-ups", who: isClubAdmin, modules: ["group_fitness"] },
      { href: "/dashboard/comp-audit", label: "Comp Audit", who: isClubAdmin },
      { href: "/dashboard/memberships", label: "Memberships", who: isClubAdmin },
      { href: "/dashboard/class-catalog", label: "Class Catalog", who: isClubAdmin },
      { href: "/dashboard/shadow-billing", label: "Shadow Billing", who: isClubAdmin },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/dashboard/settings", label: "Settings", who: isClubAdmin },
      { href: "/dashboard/settings/staff", label: "Staff & Roles", who: isClubAdmin },
      { href: "/dashboard/settings/billing", label: "Billing", who: isClubAdmin },
      { href: "/dashboard/settings/eligibility", label: "Class Eligibility", who: isClubAdmin, modules: ["group_fitness"] },
      { href: "/dashboard/settings/imports", label: "Imports", who: isClubAdmin },
      { href: "/dashboard/settings/mindbody-items", label: "Mindbody Items", who: isClubAdmin },
      { href: "/dashboard/settings/crm", label: "CRM", who: isClubAdmin, crm: true },
      { href: "/dashboard/settings/sales-targets", label: "Sales Targets", who: isClubAdmin, crm: true },
    ],
  },
  {
    label: "SynqIQ",
    items: [{ href: "/dashboard/platform", label: "Studios", platform: true }],
  },
];

// The mobile bottom bar shows the first four of these the person can see
// (instructors get their teaching pages, sales staff their sales pages);
// everything else is in the "More" popover, so nothing becomes unreachable
// on mobile, just not primary.
const MOBILE_PRIMARY_PREFERENCE = [
  "/dashboard/sales",
  "/dashboard/guests",
  "/dashboard/classes",
  "/dashboard/schedule",
  "/dashboard/sub-requests",
  "/dashboard/sales/calendar",
  "/dashboard/sales/new-members",
  "/dashboard/follow-up",
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
  const isAdmin = currentStaff ? isClubAdmin(currentStaff) : false;
  const crmEnabled = currentStaff ? await isCrmEnabled(currentStaff.organizationId) : false;
  // Platform admins are always admins of their own studio, so only admins pay for the lookup.
  const isPlatformAdmin = isAdmin && Boolean(await getPlatformAdmin());
  // No session (dropdown mode) keeps the full nav, as before modules existed.
  const enabledModules = currentStaff ? await getEnabledModules(currentStaff.organizationId) : null;
  // Unread guest texts/emails, shown as a count on "Guests" -- or, for
  // trainers (who work assigned new members), on "Follow Up".
  const guestUnread =
    currentStaff && (crmEnabled || enabledModules?.has("trainer")) ? await unreadGuestMessageCount(currentStaff) : 0;
  const unreadHref =
    currentStaff && crmEnabled && canUseCrm(currentStaff) ? "/dashboard/guests" : "/dashboard/follow-up";
  const allowed = (entry: NavEntry) => !entry.who || (currentStaff !== null && entry.who(currentStaff));

  const visibleGroups: NavGroup[] = navigation
    .map((group) => ({
      label: group.label,
      items: group.items
        .filter((item) => allowed(item) && (!item.crm || crmEnabled) && (!item.platform || isPlatformAdmin) &&
            (!item.modules || !enabledModules || item.modules.some((module) => enabledModules.has(module))),
        )
        .map(({ href, label }) => ({ href, label, badge: href === unreadHref ? guestUnread : undefined })),
    }))
    .filter((group) => group.items.length > 0);

  const visibleItems = visibleGroups.flatMap((group) => group.items);
  const primaryMobileItems = MOBILE_PRIMARY_PREFERENCE.map((href) => visibleItems.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item))
    .slice(0, 4);
  const primaryHrefs = new Set(primaryMobileItems.map((item) => item.href));
  const moreMobileItems = visibleItems.filter((item) => !primaryHrefs.has(item.href));

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

        <main className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6 md:pb-10">
          {currentStaff && currentStaff.mfa !== "ok" ? (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <span>
                <strong>Turn on two-step sign-in.</strong> Club Admins need a code from an authenticator app at sign-in;
                it will be required before member payments go live.
              </span>
              <Link href="/dashboard/account#two-step" className="font-medium underline underline-offset-4">
                Set it up
              </Link>
            </div>
          ) : null}
          {children}
        </main>
      </div>

      <BottomNav primaryItems={primaryMobileItems} moreItems={moreMobileItems} />
    </div>
  );
}
