import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ListChecks, MoreHorizontal, Wallet } from "lucide-react";
import { findStudio, type Studio } from "@/lib/member/session";

// Shared pieces for the member app (/m/<studio>): a phone-first layout in the
// studio's own color: a colored header bar, white content, and (signed in) a
// tab bar along the bottom: Book, Schedule, Wallet, More.

export async function studioOr404(param: string): Promise<Studio> {
  const studio = /^\d{1,9}$/.test(param) ? await findStudio(Number(param)) : null;
  if (!studio) notFound();
  return studio;
}

export type MemberTab = "book" | "schedule" | "wallet" | "more";

const TABS: { tab: MemberTab; label: string; path: string; Icon: typeof CalendarDays }[] = [
  { tab: "book", label: "Book", path: "", Icon: CalendarDays },
  { tab: "schedule", label: "Schedule", path: "/my-classes", Icon: ListChecks },
  { tab: "wallet", label: "Wallet", path: "/wallet", Icon: Wallet },
  { tab: "more", label: "More", path: "/more", Icon: MoreHorizontal },
];

// The header bar in the studio's color.
export function MemberHeader({ studio, title, action, icon }: { studio: Studio; title: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 text-white shadow-sm" style={{ background: studio.primaryColor }}>
      <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-3 px-4">
        <h1 className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold">
          {icon}
          <span className="truncate">{title}</span>
        </h1>
        {action ? <div className="flex shrink-0 items-center gap-3 text-sm">{action}</div> : null}
      </div>
    </header>
  );
}

// Signed-in app screens: header + content + bottom tab bar.
export function MemberApp({
  studio,
  title,
  tab,
  action,
  icon,
  children,
}: {
  studio: Studio;
  title: ReactNode;
  tab: MemberTab;
  action?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-100 font-sans text-neutral-900">
      <MemberHeader studio={studio} title={title} action={action} icon={icon} />
      <main className="mx-auto max-w-md pb-24">{children}</main>
      <MemberTabs studio={studio} active={tab} />
    </div>
  );
}

export function MemberTabs({ studio, active }: { studio: Studio; active: MemberTab }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ tab, label, path, Icon }) => {
          const on = tab === active;
          return (
            <Link
              key={tab}
              href={`/m/${studio.siteId}${path}`}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-semibold" : "text-neutral-500"}`}
              style={on ? { color: studio.primaryColor } : undefined}
              aria-current={on ? "page" : undefined}
            >
              <Icon className="size-6" strokeWidth={on ? 2.4 : 1.8} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// A white section on the grey app background (lists, forms).
export function MemberSection({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-3 bg-white ${className}`}>
      {title ? <h2 className="px-4 pt-4 pb-1 text-lg font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

// Signed-out screens (sign in, passwords): the studio header and one card.
export function MemberShell({ studio, title, children }: { studio: Studio; title?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-100 font-sans text-neutral-900">
      <MemberHeader
        studio={studio}
        title={studio.name}
        icon={
          studio.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- studio logo
            <img src={studio.logoUrl} alt="" className="h-7 w-auto rounded bg-white/90 p-0.5" />
          ) : null
        }
        action={
          <Link href={`/m/${studio.siteId}`} className="underline-offset-4 hover:underline">
            Schedule
          </Link>
        }
      />
      <main className="mx-auto max-w-md px-4 py-6">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          {title ? <h2 className="mb-4 text-2xl font-semibold">{title}</h2> : null}
          {children}
        </div>
      </main>
    </div>
  );
}

export function BookingClosed({ studio }: { studio: Studio }) {
  return (
    <MemberShell studio={studio} title="Online booking">
      <p className="text-sm text-neutral-600">Online booking isn&apos;t available yet. Please book with the front desk.</p>
    </MemberShell>
  );
}

export const UUID = /^[0-9a-f-]{36}$/i;
