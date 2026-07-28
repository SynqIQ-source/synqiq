"use client";

import { useState } from "react";
import Link from "next/link";

type NavItem = { href: string; label: string };

// The desktop sidebar is `hidden md:block` with no mobile equivalent at all
// -- below that breakpoint there was previously no way to reach any page
// except whichever one you landed on directly. This is the mobile
// equivalent: a toggle button in the header that reveals the same nav list
// as a dropdown.
export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-lg text-zinc-700"
      >
        {open ? "✕" : "☰"}
      </button>
      {open && (
        <nav className="absolute right-0 top-11 z-40 w-56 rounded-md border border-zinc-200 bg-white p-2 shadow-lg">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
