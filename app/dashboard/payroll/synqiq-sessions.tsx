import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

export type SynqiqSessionEvent = {
  id: string;
  staffName: string;
  workDate: string;
  description: string;
  clientName: string | null;
  valueCents: number | null;
  valueSource: string | null;
  rateName: string | null;
  amountCents: number;
  noShow: boolean;
};

// Sessions completed on SynqIQ's Trainer Calendar in the pay period (their
// payroll events), beside the session pay figured from Mindbody. Practice:
// not in the totals above until payroll moves off Mindbody.
export function SynqiqSessions({ events, mindbodyByStaff }: { events: SynqiqSessionEvent[]; mindbodyByStaff: Record<string, number> }) {
  const synqBy = new Map<string, number>();
  for (const event of events) synqBy.set(event.staffName, (synqBy.get(event.staffName) ?? 0) + event.amountCents);
  const names = [...new Set([...synqBy.keys(), ...Object.keys(mindbodyByStaff)])].sort();
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>SynqIQ trainer sessions (practice)</CardTitle>
        <CardDescription>
          Sessions completed on the Trainer Calendar, recorded on the day of the session, next to the session pay from Mindbody. Not
          included in the totals above until payroll moves off Mindbody.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {events.length === 0 ? <p className="text-sm text-muted-foreground">No sessions completed in SynqIQ in this period.</p> : null}
        {names.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trainer</TableHead>
                <TableHead className="text-right">Mindbody sessions</TableHead>
                <TableHead className="text-right">SynqIQ sessions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {names.map((name) => (
                <TableRow key={name}>
                  <TableCell>{name}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(mindbodyByStaff[name] ?? 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(synqBy.get(name) ?? 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {events.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Trainer</TableHead>
                <TableHead>Session</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead className="text-right">Pay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap">{DateTime.fromISO(event.workDate).toFormat("ccc LLL d")}</TableCell>
                  <TableCell>{event.staffName}</TableCell>
                  <TableCell>
                    {event.description}
                    {event.noShow ? (
                      <Badge variant="secondary" className="ml-1">
                        No-show
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    {event.clientName}
                    {event.valueSource ? ` · ${event.valueSource}` : " · no pack"}
                    {event.valueCents != null ? ` · ${money(event.valueCents)}/session` : ""}
                  </TableCell>
                  <TableCell className="text-sm">{event.rateName ?? <span className="text-destructive">No rate</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(event.amountCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
