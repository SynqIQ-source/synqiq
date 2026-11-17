import Link from "next/link";
import { DateTime } from "luxon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FitnessDashboard } from "@/lib/dashboard/fitness";
import { SELLER_GROUP_LABELS, percentOf } from "@/lib/dashboard/fitness-math";
import { FitnessGoalsForm } from "./goals-form";

export const FITNESS_VIEWS = ["sales", "sessions", "intros", "goals", "trainers"] as const;
export type FitnessView = (typeof FITNESS_VIEWS)[number];

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => DateTime.fromISO(iso).toFormat("ccc LLL d");
const pct = (value: number | null) => (value == null ? "—" : `${value}%`);
const sessionsText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

// The details under a Fitness Dashboard card.
export function FitnessDrillDown({ view, data, canSetGoals }: { view: FitnessView; data: FitnessDashboard; canSetGoals: boolean }) {
  if (view === "sales") return <Sales data={data} />;
  if (view === "sessions") return <Sessions data={data} />;
  if (view === "intros") return <Intros data={data} />;
  if (view === "goals") return <Goals data={data} canSetGoals={canSetGoals} />;
  return <Trainers data={data} />;
}

const monthLabel = (data: FitnessDashboard) => DateTime.fromISO(data.periods.mtdFrom).toFormat("LLLL");

function Sales({ data }: { data: FitnessDashboard }) {
  const { sales } = data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>PT sales · {monthLabel(data)} to date</CardTitle>
        <CardDescription>
          Personal training sold at SynqIQ&apos;s checkout, before tax. Credit goes to the commission split chosen at checkout, or to
          whoever rang it up. Sales and Sales Leads count as the sales team.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sold by</TableHead>
              <TableHead className="text-right">Sessions sold</TableHead>
              <TableHead className="text-right">Avg / session</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.groups.map((group) => (
              <TableRow key={group.group}>
                <TableCell className="font-medium">{SELLER_GROUP_LABELS[group.group]}</TableCell>
                <TableCell className="text-right tabular-nums">{sessionsText(group.sessions)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {group.avgSessionCents == null ? "—" : money(group.avgSessionCents)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{money(group.cents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{sessionsText(sales.sessionsSold)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {sales.avgSessionCents == null ? "—" : money(sales.avgSessionCents)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(sales.totalCents)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>

        {sales.people.length ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">By person</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Sessions sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.people.map((person) => (
                  <TableRow key={person.staffId}>
                    <TableCell className="font-medium">{person.name}</TableCell>
                    <TableCell className="text-muted-foreground">{SELLER_GROUP_LABELS[person.group]}</TableCell>
                    <TableCell className="text-right tabular-nums">{sessionsText(person.sessions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(person.cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 text-sm font-semibold">What was sold</h3>
          {sales.lines.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Sale</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.lines.map((line) => (
                  <TableRow key={line.lineId}>
                    <TableCell className="whitespace-nowrap">{day(line.day)}</TableCell>
                    <TableCell className="tabular-nums">#{line.saleNumber}</TableCell>
                    <TableCell>{line.client}</TableCell>
                    <TableCell>
                      {line.name}
                      {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{line.sessions == null ? "—" : line.sessions * line.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(line.amountCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No personal training sold at SynqIQ&apos;s checkout yet this month.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Sessions({ data }: { data: FitnessDashboard }) {
  const { sessions } = data;
  const rows = [...sessions.days].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions · {monthLabel(data)} to date, day by day</CardTitle>
        <CardDescription>
          Scheduled counts every session booked for the day except ones cancelled ahead of time. Completed is sessions marked completed.
          &quot;Not closed&quot; are past sessions still waiting to be marked.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead className="text-right">Scheduled</TableHead>
              <TableHead className="text-right">Completed</TableHead>
              <TableHead className="text-right">No-show</TableHead>
              <TableHead className="text-right">Late cancel</TableHead>
              <TableHead className="text-right">Not closed</TableHead>
              <TableHead className="text-right">Completed %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.day} className={row.scheduled ? undefined : "text-muted-foreground"}>
                <TableCell className="whitespace-nowrap">{day(row.day)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.scheduled}</TableCell>
                <TableCell className="text-right tabular-nums">{row.completed}</TableCell>
                <TableCell className="text-right tabular-nums">{row.noShow}</TableCell>
                <TableCell className="text-right tabular-nums">{row.lateCancel}</TableCell>
                <TableCell className="text-right tabular-nums">{row.open}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(percentOf(row.completed, row.scheduled))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Month to date</TableCell>
              <TableCell className="text-right tabular-nums">{sessions.scheduled}</TableCell>
              <TableCell className="text-right tabular-nums">{sessions.completed}</TableCell>
              <TableCell className="text-right tabular-nums">{sessions.days.reduce((sum, row) => sum + row.noShow, 0)}</TableCell>
              <TableCell className="text-right tabular-nums">{sessions.days.reduce((sum, row) => sum + row.lateCancel, 0)}</TableCell>
              <TableCell className="text-right tabular-nums">{sessions.days.reduce((sum, row) => sum + row.open, 0)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(sessions.percent)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

function Intros({ data }: { data: FitnessDashboard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Intro workouts · next 7 days</CardTitle>
        <CardDescription>
          {day(data.periods.today)} – {day(data.weekEnd)}. Booked intro workouts and who they&apos;re with.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.intros.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Trainer</TableHead>
                <TableHead>Session</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.intros.map((intro) => (
                <TableRow key={intro.id}>
                  <TableCell className="whitespace-nowrap">{intro.time}</TableCell>
                  <TableCell>
                    <Link href={`/dashboard/memberships/${intro.clientId}`} className="font-medium hover:underline">
                      {intro.client}
                    </Link>
                  </TableCell>
                  <TableCell>{intro.trainer}</TableCell>
                  <TableCell className="text-muted-foreground">{intro.type}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            No intro workouts booked in SynqIQ for the next 7 days. New members waiting on an intro are on{" "}
            <Link href="/dashboard/sales/new-members" className="underline">
              New Members
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Pace({
  label,
  actual,
  goal,
  projected,
  format,
}: {
  label: string;
  actual: number;
  goal: number | null;
  projected: number;
  format: (n: number) => string;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="text-right tabular-nums">{format(actual)}</TableCell>
      <TableCell className="text-right tabular-nums">{goal == null ? "No goal" : format(goal)}</TableCell>
      <TableCell className="text-right tabular-nums">{goal ? pct(percentOf(actual, goal)) : "—"}</TableCell>
      <TableCell className="text-right font-semibold tabular-nums">{format(projected)}</TableCell>
      <TableCell className="text-right tabular-nums">{goal ? pct(percentOf(projected, goal)) : "—"}</TableCell>
    </TableRow>
  );
}

function Goals({ data, canSetGoals }: { data: FitnessDashboard; canSetGoals: boolean }) {
  const { goals } = data;
  const carried = goals.fromMonth && goals.fromMonth !== goals.month ? DateTime.fromISO(goals.fromMonth).toFormat("LLLL yyyy") : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Goals and pace · {monthLabel(data)}</CardTitle>
        <CardDescription>
          Straight-line projection: month to date ÷ {goals.sessions.daysGone} days gone × {goals.sessions.daysInMonth} days in the month.
          {carried ? ` Goals carried over from ${carried}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead className="text-right">Month to date</TableHead>
              <TableHead className="text-right">Goal</TableHead>
              <TableHead className="text-right">% of goal</TableHead>
              <TableHead className="text-right">Projected finish</TableHead>
              <TableHead className="text-right">Projected % of goal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Pace label="Sessions serviced" {...goals.sessions} format={(n) => n.toLocaleString()} />
            <Pace label="PT sales" {...goals.sales} format={money} />
          </TableBody>
        </Table>
        {canSetGoals ? (
          <FitnessGoalsForm
            month={goals.month}
            monthLabel={monthLabel(data)}
            sessions={goals.sessions.goal}
            salesDollars={goals.sales.goal == null ? null : goals.sales.goal / 100}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Trainers({ data }: { data: FitnessDashboard }) {
  const { rows, averages } = data.trainers;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Per trainer · {monthLabel(data)} to date</CardTitle>
        <CardDescription>
          Every trainer with sessions on the books or PT sales credited this month ({averages.trainers}). The averages are the mean across
          them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trainer</TableHead>
                <TableHead className="text-right">Scheduled</TableHead>
                <TableHead className="text-right">Serviced</TableHead>
                <TableHead className="text-right">Completed %</TableHead>
                <TableHead className="text-right">Sessions sold</TableHead>
                <TableHead className="text-right">PT sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.staffId}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.scheduled}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.completed}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(percentOf(row.completed, row.scheduled))}</TableCell>
                  <TableCell className="text-right tabular-nums">{sessionsText(row.sessionsSold)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.salesCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Average per trainer</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">{averages.sessions ?? "—"}</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right tabular-nums">{averages.salesCents == null ? "—" : money(averages.salesCents)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No trainer sessions or PT sales in SynqIQ yet this month.</p>
        )}
      </CardContent>
    </Card>
  );
}
