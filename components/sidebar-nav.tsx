"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActiveNavHref } from "@/lib/nav-active";
import type { NavItem } from "./bottom-nav";

// The mobile bottom nav already highlights its active tab with
// primary_color -- the desktop sidebar had no active-page indicator at all
// until now. Uses secondary_color rather than reusing primary so an org can
// tune the two independently instead of the sidebar always matching
// whatever CTA buttons look like.
export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="mt-8 flex flex-col gap-1">
      {items.map((item) => {
        const active = isActiveNavHref(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              active
                ? "bg-secondary-subtle text-secondary"
                : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
