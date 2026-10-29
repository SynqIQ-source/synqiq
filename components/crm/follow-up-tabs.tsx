import Link from "next/link";
import { cn } from "@/lib/utils";

// Follow Up's two lists: class check-ins (the instructor email relay) and,
// with the CRM module, new members assigned to this trainer for an intro.
export function FollowUpTabs({
  active,
  newMembersBadge,
}: {
  active: "classes" | "new-members";
  newMembersBadge?: number;
}) {
  const tabs = [
    { key: "classes", href: "/dashboard/follow-up", label: "Class check-ins" },
    { key: "new-members", href: "/dashboard/follow-up/new-members", label: "New members" },
  ] as const;
  return (
    <nav aria-label="Follow Up" className="mb-6 flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === tab.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.key === "new-members" && newMembersBadge ? (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs leading-none text-primary-foreground tabular-nums">
              {newMembersBadge}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
