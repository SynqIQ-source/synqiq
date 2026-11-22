"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { isActiveNavHref } from "@/lib/nav-active";
import { NAV_ICONS_BY_HREF } from "@/lib/nav-icons";
import { cn } from "@/lib/utils";
import type { NavItem } from "./bottom-nav";

export type NavGroup = { label: string | null; items: NavItem[] };

const OPEN_KEY = "synqiq-nav-open";

const allItems = (items: NavItem[]): NavItem[] => items.flatMap((item) => [item, ...allItems(item.children ?? [])]);

// When more than one item matches (e.g. /dashboard/settings is a prefix of
// /dashboard/settings/staff), only the most specific one is active -- so
// "Settings" doesn't stay highlighted while you're on "Staff Logins".
function activeHref(pathname: string, groups: NavGroup[]): string | null {
  const matches = allItems(groups.flatMap((group) => group.items))
    .filter((item) => isActiveNavHref(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}

function readOpen(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function NavLink({ item, active, nested }: { item: NavItem; active: boolean; nested?: boolean }) {
  const Icon = NAV_ICONS_BY_HREF[item.href];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        nested && "pl-5",
        active ? "bg-sidebar-active font-semibold text-white" : "text-sidebar-foreground hover:bg-sidebar-active hover:text-white",
      )}
    >
      {Icon ? <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary-subtle")} /> : null}
      <span className="truncate">{item.label}</span>
      {item.badge ? (
        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums">
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const current = activeHref(pathname, groups);
  // Expandable parents (e.g. Staff & Roles): remembered per browser, and
  // always open while you're on one of their pages.
  const [open, setOpen] = useState<string[]>([]);
  useEffect(() => setOpen(readOpen()), []);
  const toggle = (href: string) =>
    setOpen((value) => {
      const next = value.includes(href) ? value.filter((item) => item !== href) : [...value, href];
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // private window: just don't remember it
      }
      return next;
    });

  return (
    <nav className="flex flex-col gap-5">
      {groups.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className="flex flex-col gap-0.5">
          {group.label ? (
            <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-sidebar-foreground/70 uppercase">{group.label}</p>
          ) : null}
          {group.items.map((item) => {
            const children = item.children ?? [];
            if (!children.length) return <NavLink key={item.href} item={item} active={item.href === current} />;
            const childActive = children.some((child) => child.href === current);
            const expanded = childActive || open.includes(item.href);
            return (
              <div key={item.href} className="flex flex-col gap-0.5">
                <div className="flex items-center">
                  <NavLink item={item} active={item.href === current} />
                  <button
                    type="button"
                    onClick={() => toggle(item.href)}
                    disabled={childActive}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} ${item.label} pages`}
                    className="rounded-md p-1.5 text-sidebar-foreground hover:bg-sidebar-active hover:text-white disabled:opacity-40"
                  >
                    <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
                  </button>
                </div>
                {expanded ? (
                  <div className="ml-3 flex flex-col gap-0.5 border-l border-white/10">
                    {children.map((child) => (
                      <NavLink key={child.href} item={child} active={child.href === current} nested />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
