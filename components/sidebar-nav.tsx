"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActiveNavHref } from "@/lib/nav-active";
import { NAV_ICONS_BY_HREF } from "@/lib/nav-icons";
import { cn } from "@/lib/utils";
import type { NavItem } from "./bottom-nav";

export type NavGroup = { label: string | null; items: NavItem[] };

// When more than one item matches (e.g. /dashboard/settings is a prefix of
// /dashboard/settings/staff), only the most specific one is active -- so
// "Settings" doesn't stay highlighted while you're on "Staff Logins".
function activeHref(pathname: string, groups: NavGroup[]): string | null {
  const matches = groups
    .flatMap((group) => group.items)
    .filter((item) => isActiveNavHref(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const current = activeHref(pathname, groups);

  return (
    <nav className="flex flex-col gap-5">
      {groups.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className="flex flex-col gap-0.5">
          {group.label ? (
            <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {group.label}
            </p>
          ) : null}
          {group.items.map((item) => {
            const Icon = NAV_ICONS_BY_HREF[item.href];
            const active = item.href === current;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-subtle text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
