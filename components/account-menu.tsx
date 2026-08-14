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
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white/15 text-sm font-semibold text-white ring-2 ring-white/30 hover:ring-white/50"
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
        <div className="absolute right-0 mt-2 w-56 rounded-lg border border-zinc-200 bg-white py-2 shadow-lg">
          <div className="border-b border-zinc-100 px-4 py-2">
            <p className="truncate text-sm font-medium text-zinc-950">{displayName}</p>
            <p className="truncate text-xs text-zinc-500">
              {title ? `${title} · ` : ""}
              {role === "admin" ? "Admin" : "Instructor"}
            </p>
          </div>
          <Link
            href="/dashboard/account"
            onClick={() => setIsOpen(false)}
            className="block px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            My Account
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
