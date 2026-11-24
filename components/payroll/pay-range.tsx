import Link from "next/link";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Date range + pay period shortcuts for the payroll pages, and the tabs that
// move between Payroll and its detail reports with the same dates.

export const PAYROLL_REPORTS = [
  { href: "/dashboard/payroll", label: "Payroll" },
  { href: "/dashboard/payroll/sessions", label: "Sessions Serviced" },
  { href: "/dashboard/payroll/classes", label: "Class Pay" },
  { href: "/dashboard/timesheets", label: "Timesheets" },
  { href: "/dashboard/payroll/commissions", label: "Commission Report" },
] as const;

export function PayRange({
  path,
  from,
  to,
  presets,
  extra,
}: {
  path: string;
  from: string;
  to: string;
  presets: { current: { from: string; to: string }; last: { from: string; to: string } };
  extra?: Record<string, string>;
}) {
  const query = (range: { from: string; to: string }) => new URLSearchParams({ ...extra, ...range }).toString();
  return (
    <div className="space-y-3">
      <nav className="flex flex-wrap gap-1 border-b pb-2" aria-label="Payroll reports">
        {PAYROLL_REPORTS.map((report) => (
          <Link
            key={report.href}
            href={`${report.href}?${new URLSearchParams({ from, to }).toString()}`}
            aria-current={report.href === path ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              report.href === path ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {report.label}
          </Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-2" method="get" action={path}>
        {Object.entries(extra ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="text-sm">
          From
          <Input type="date" name="from" defaultValue={from} className="h-9" />
        </label>
        <label className="text-sm">
          To
          <Input type="date" name="to" defaultValue={to} className="h-9" />
        </label>
        <Button type="submit" variant="outline" size="sm">
          Show
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={`${path}?${query(presets.last)}`}>Last pay period</a>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={`${path}?${query(presets.current)}`}>This pay period</a>
        </Button>
        <span className="pb-2 text-sm text-muted-foreground">
          {DateTime.fromISO(from).toFormat("LLL d")} – {DateTime.fromISO(to).toFormat("LLL d, yyyy")}
        </span>
      </form>
    </div>
  );
}
