import Link from "next/link";
import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ClubOverview } from "@/lib/dashboard/club";
import { HEAT_DAYS, HEAT_HOURS } from "@/lib/dashboard/club-math";
import { STATUS_LABELS } from "@/lib/maintenance/rules";

export const DRILL_VIEWS = ["members", "sales", "checkins", "guests", "maintenance"] as const;
export type DrillView = (typeof DRILL_VIEWS)[number];

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? DateTime.fromISO(iso).toFormat("LLL d") : "—");
const hourLabel = (hour: number) => DateTime.fromObject({ hour }).toFormat("h a");

// The details under a Club Overview card.
export function ClubDrillDown({ view, data }: { view: DrillView; data: ClubOverview }) {
  if (view === "members") return <Members data={data} />;
  if (view === "sales") return <Sales data={data} />;
  if (view === "checkins") return <CheckIns data={data} />;
  if (view === "guests") return <Guests data={data} />;
  return <Maintenance data={data} />;
}

const monthLabel = (data: ClubOverview) => DateTime.fromISO(data.periods.mtdFrom).toFormat("LLLL");

function Person({ client, person }: { client: string; person: string }) {
  return (
    <Link href={`/dashboard/memberships/${client}`} className="font-medium hover:underline">
      {person}
    </Link>
  );
}

function Members({ data }: { data: ClubOverview }) {
  const { movement } = data.members;
  const rows: { label: string; count: number; sign: "+" | "−" | ""; note: string }[] = [
    { label: "Sold", count: movement.sold.length, sign: "+", note: "Memberships sold this month" },
    { label: "Cancelled", count: movement.cancelled.length, sign: "−", note: "By the day the cancellation was entered" },
    { label: "Frozen", count: movement.frozen.length, sign: "−", note: "Freezes starting this month" },
    { label: "Unfrozen", count: movement.unfrozen.length, sign: "+", note: "Back from a freeze this month" },
  ];
  const lists: { title: string; empty: string; items: { key: string; person: { client: string; person: string }; detail: string }[] }[] = [
    {
      title: "Sold",
      empty: "No memberships sold yet this month.",
      items: movement.sold.map((row, index) => ({ key: `s${index}`, person: row, detail: `${row.membership} · ${day(row.day)}` })),
    },
    {
      title: "Cancelled",
      empty: "No cancellations entered this month.",
      items: movement.cancelled.map((row, index) => ({
        key: `c${index}`,
        person: row,
        detail: `entered ${day(row.day)} · ends ${day(row.effective)}`,
      })),
    },
    {
      title: "Frozen",
      empty: "No freezes started this month.",
      items: movement.frozen.map((row, index) => ({ key: `f${index}`, person: row, detail: `${day(row.from)} – ${day(row.to)}` })),
    },
    {
      title: "Unfrozen",
      empty: "Nobody came back from a freeze this month.",
      items: movement.unfrozen.map((row, index) => ({ key: `u${index}`, person: row, detail: `back ${day(row.day)}` })),
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members · {monthLabel(data)} to date</CardTitle>
        <CardDescription>
          {data.members.active.toLocaleString()} active (billing) today · {data.members.frozen.toLocaleString()} frozen, not counted as
          active.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Table>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-muted-foreground">{row.note}</TableCell>
                <TableCell className="text-right text-base font-semibold tabular-nums">
                  {row.count ? `${row.sign}${row.count}` : "0"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Net</TableCell>
              <TableCell className="text-muted-foreground">Sold − cancelled − frozen + unfrozen</TableCell>
              <TableCell className="text-right text-base font-semibold tabular-nums">
                {movement.net > 0 ? `+${movement.net}` : movement.net}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        <div className="grid gap-4 md:grid-cols-2">
          {lists.map((list) => (
            <div key={list.title}>
              <p className="mb-1 text-sm font-semibold">
                {list.title} <span className="font-normal text-muted-foreground">({list.items.length})</span>
              </p>
              {list.items.length ? (
                <ul className="space-y-1 text-sm">
                  {list.items.map((item) => (
                    <li key={item.key}>
                      <Person {...item.person} /> <span className="text-muted-foreground">· {item.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{list.empty}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Sales({ data }: { data: ClubOverview }) {
  const { sales } = data;
  return (
    <div className="space-y-4">
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Sales by revenue category · {monthLabel(data)} to date</CardTitle>
          <CardDescription>Membership packages are split into their parts (for example registration fee and dues).</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Revenue category</TableHead>
              <TableHead className="text-right">Share</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.byCategory.length ? (
              sales.byCategory.map((row) => (
                <TableRow key={row.category}>
                  <TableCell className="font-medium">{row.category}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {sales.mtdCents ? `${Math.round((row.cents / sales.mtdCents) * 100)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.cents)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                  No sales yet this month.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell />
              <TableCell className="text-right font-semibold tabular-nums">{money(sales.mtdCents)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Today&apos;s transactions</CardTitle>
          <CardDescription>
            Checkout {money(data.revenueToday.posCents)} · Autopays {money(data.revenueToday.autopayCents)} · Total{" "}
            {money(data.revenueToday.totalCents)}
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Sale</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Rung up by</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.today.length ? (
              sales.today.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="text-muted-foreground">{sale.time}</TableCell>
                  <TableCell>
                    #{sale.number}
                    {sale.status === "practice" ? (
                      <Badge variant="outline" className="ml-1.5">
                        Practice
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-normal">{sale.client}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{sale.items}</TableCell>
                  <TableCell className="whitespace-normal">{sale.staff}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(sale.totalCents)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  No checkout sales yet today.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function CheckIns({ data }: { data: ClubOverview }) {
  const days = data.checkIns.byDay;
  const max = Math.max(1, ...days.map(([, count]) => count));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Front-desk check-ins by day · {monthLabel(data)}</CardTitle>
        <CardDescription>
          Every front-desk or kiosk check-in counts, including a second one the same day. Classes, pool lanes and personal training
          aren&apos;t included.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {days.length ? (
          <ul className="space-y-1">
            {days.map(([date, count]) => (
              <li key={date} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground">{DateTime.fromISO(date).toFormat("ccc LLL d")}</span>
                <span className="h-4 rounded-sm bg-primary/70" style={{ width: `${Math.max(2, (count / max) * 100)}%` }} />
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No check-ins yet this month.</p>
        )}
      </CardContent>
    </Card>
  );
}

// Day of week across, time of day down (6 AM to 9 PM); darker = busier.
function Guests({ data }: { data: ClubOverview }) {
  const { grid, max, outside } = data.guests.heat;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Guest traffic · {monthLabel(data)} to date</CardTitle>
        <CardDescription>
          {data.guests.mtd} guest visits by day of the week and hour they came in.
          {outside ? ` ${outside} came in before 6 AM or after 9 PM (not shown).` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="w-14" />
              {HEAT_DAYS.map((label) => (
                <th key={label} className="font-medium text-muted-foreground">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEAT_HOURS.map((hour, row) => (
              <tr key={hour}>
                <th className="pr-1 text-right font-normal whitespace-nowrap text-muted-foreground">{hourLabel(hour)}</th>
                {grid[row].map((count, column) => (
                  <td
                    key={column}
                    title={`${HEAT_DAYS[column]} ${hourLabel(hour)}: ${count} ${count === 1 ? "visit" : "visits"}`}
                    className="h-7 rounded-sm text-center tabular-nums"
                    style={{
                      backgroundColor: count
                        ? `color-mix(in oklab, var(--primary) ${Math.round(15 + (count / Math.max(1, max)) * 85)}%, transparent)`
                        : "var(--muted)",
                      color: count / Math.max(1, max) > 0.55 ? "var(--primary-foreground)" : undefined,
                    }}
                  >
                    {count || ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Maintenance({ data }: { data: ClubOverview }) {
  const { open } = data.maintenance;
  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle>Equipment down</CardTitle>
        <CardDescription>
          {data.maintenance.downNew} new (nobody has acted yet) · {data.maintenance.downInProgress} in progress · average{" "}
          {data.maintenance.avgDaysDown ?? 0} days down.{" "}
          <Link href="/dashboard/maintenance" className="text-primary underline-offset-4 hover:underline">
            Open Maintenance
          </Link>
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Report</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Days down</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {open.length ? (
            [...open]
              .sort((a, b) => Number(b.critical) - Number(a.critical) || b.days - a.days)
              .map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell className="whitespace-normal">
                    <Link href={`/dashboard/maintenance/${issue.id}`} className="font-medium hover:underline">
                      {issue.title}
                    </Link>
                    {issue.critical ? (
                      <Badge variant="destructive" className="ml-2">
                        Critical
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {issue.status === "reported" ? (
                      <Badge variant="outline">New</Badge>
                    ) : (
                      (STATUS_LABELS[issue.status as keyof typeof STATUS_LABELS] ?? issue.status)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{issue.days}</TableCell>
                </TableRow>
              ))
          ) : (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                Nothing is down right now.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
