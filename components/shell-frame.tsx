"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";

// The desktop sidebar + page column. Normally the sidebar is always shown.
// Full-width pages (POS) start with it hidden and a Menu button slides it
// in over the page, so the screen keeps its room.
export function ShellFrame({ sidebar, fullWidth, children }: { sidebar: React.ReactNode; fullWidth?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!fullWidth) {
    return (
      <>
        <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-card md:flex">{sidebar}</aside>
        <div className="md:pl-60">{children}</div>
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-label="Show menu"
        onClick={() => setOpen(true)}
        className="fixed top-4 left-3 z-40 hidden size-11 items-center justify-center rounded-lg border bg-card shadow-sm hover:bg-muted md:flex"
      >
        <Menu className="size-5" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40 hidden bg-black/30 md:block" onClick={() => setOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 hidden w-60 flex-col border-r bg-card shadow-xl md:flex">
            <button
              type="button"
              aria-label="Hide menu"
              onClick={() => setOpen(false)}
              className="absolute top-4 right-2 flex size-9 items-center justify-center rounded-md hover:bg-muted"
            >
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </>
      ) : null}
      <div className="md:pl-16">{children}</div>
    </>
  );
}
