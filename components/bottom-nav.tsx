"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Bell,
  Calendar,
  ClipboardList,
  Flame,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Repeat2,
  Settings,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string };

const ICONS_BY_HREF: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/classes": BookOpen,
  "/dashboard/schedule": Calendar,
  "/dashboard/sub-requests": Repeat2,
  "/dashboard/messages": MessageSquare,
  "/dashboard/notifications": Bell,
  "/dashboard/heatmap": Flame,
  "/dashboard/instructors": Users,
  "/dashboard/substitutions": ClipboardList,
  "/dashboard/settings": Settings,
  "/dashboard/settings/imports": Upload,
};

// Shorter labels than the desktop sidebar's -- these sit under a small
// icon at ~78px tab width, where "My Schedule"/"Sub Requests"/"Message
// Boards" would wrap or truncate. Falls back to the item's own label
// (used as-is in the "More" popover, where width isn't a constraint).
const PRIMARY_LABEL_OVERRIDES: Record<string, string> = {
  "/dashboard/schedule": "Schedule",
  "/dashboard/sub-requests": "Requests",
  "/dashboard/messages": "Messages",
};

function isActive(pathname: string, href: string) {
  // Exact match for "/dashboard" itself (Overview) -- otherwise every
  // other /dashboard/* page would also match its prefix. Prefix match for
  // everything else so a nested route (e.g. a future /dashboard/classes/[id])
  // still highlights the right tab.
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function TabIcon({ href, className }: { href: string; className: string }) {
  const Icon = ICONS_BY_HREF[href];
  return Icon ? <Icon className={className} /> : null;
}

export function BottomNav({
  primaryItems,
  moreItems,
}: {
  primaryItems: NavItem[];
  moreItems: NavItem[];
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const moreIsActive = moreItems.some((item) => isActive(pathname, item.href));

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch bg-primary pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Primary"
    >
      {primaryItems.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMoreOpen(false)}
            className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${
              active ? "text-white" : "text-white/70"
            }`}
          >
            {active && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-white" />}
            <TabIcon href={item.href} className="h-5 w-5" />
            <span>{PRIMARY_LABEL_OVERRIDES[item.href] ?? item.label}</span>
          </Link>
        );
      })}

      {moreItems.length > 0 && (
        <div className="relative flex flex-1">
          <button
            type="button"
            onClick={() => setMoreOpen((prev) => !prev)}
            aria-label={moreOpen ? "Close more menu" : "Open more menu"}
            aria-expanded={moreOpen}
            className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${
              moreOpen || moreIsActive ? "text-white" : "text-white/70"
            }`}
          >
            {(moreOpen || moreIsActive) && (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-white" />
            )}
            <MoreHorizontal className="h-5 w-5" />
            <span>More</span>
          </button>

          {moreOpen && (
            <ul className="absolute bottom-full right-0 mb-2 w-56 rounded-md border border-zinc-200 bg-white p-2 shadow-lg">
              {moreItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
                        active ? "text-primary" : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
                      }`}
                    >
                      <TabIcon href={item.href} className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </nav>
  );
}
