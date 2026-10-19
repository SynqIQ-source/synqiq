"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AccountMenuProps = {
  displayName: string;
  role: "admin" | "instructor";
  title: string | null;
  photoUrl: string | null;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

export function AccountMenu({ displayName, role, title, photoUrl }: AccountMenuProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary-subtle text-sm font-semibold text-primary ring-1 ring-border transition hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {photoUrl ? (
          // Avatar source is arbitrary per-user Storage content, not a
          // static asset Next's image optimizer needs to know about at
          // build time.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initials(displayName)
        )}
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-lg border bg-popover py-1.5 text-popover-foreground shadow-lg">
          <div className="border-b px-4 py-2">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {title ? `${title} · ` : ""}
              {role === "admin" ? "Admin" : "Instructor"}
            </p>
          </div>
          <Link
            href="/dashboard/account"
            onClick={() => setIsOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-accent"
          >
            My Account
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full px-4 py-2 text-left text-sm hover:bg-accent"
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
