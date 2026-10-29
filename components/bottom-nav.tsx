"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActiveNavHref } from "@/lib/nav-active";
import { MoreHorizontal } from "lucide-react";
import { NAV_ICONS_BY_HREF } from "@/lib/nav-icons";

// badge: an unread count shown next to the item (e.g. new guest messages).
export type NavItem = { href: string; label: string; badge?: number };


// Shorter labels than the desktop sidebar's -- these sit under a small
// icon at ~78px tab width, where "My Schedule"/"Sub Requests"/"Message
// Boards" would wrap or truncate. Falls back to the item's own label
// (used as-is in the "More" popover, where width isn't a constraint).
const PRIMARY_LABEL_OVERRIDES: Record<string, string> = {
  "/dashboard/schedule": "Schedule",
  "/dashboard/sub-requests": "Requests",
  "/dashboard/messages": "Messages",
};

function TabIcon({ href, className }: { href: string; className: string }) {
  const Icon = NAV_ICONS_BY_HREF[href];
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

  const moreIsActive = moreItems.some((item) => isActiveNavHref(pathname, item.href));

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Primary"
    >
      {primaryItems.map((item) => {
        const active = isActiveNavHref(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMoreOpen(false)}
            className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${
              active ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {active && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary" />}
            <TabIcon href={item.href} className="h-5 w-5" />
            {item.badge ? <span className="absolute top-1.5 right-1/4 h-2 w-2 rounded-full bg-primary" /> : null}
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
              moreOpen || moreIsActive ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {(moreOpen || moreIsActive) && (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary" />
            )}
            <MoreHorizontal className="h-5 w-5" />
            {moreItems.some((item) => item.badge) ? (
              <span className="absolute top-1.5 right-1/4 h-2 w-2 rounded-full bg-primary" />
            ) : null}
            <span>More</span>
          </button>

          {moreOpen && (
            <ul className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg">
              {moreItems.map((item) => {
                const active = isActiveNavHref(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
                        active ? "bg-primary-subtle text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <TabIcon href={item.href} className="h-4 w-4" />
                      {item.label}
                      {item.badge ? <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums">{item.badge > 99 ? "99+" : item.badge}</span> : null}
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
