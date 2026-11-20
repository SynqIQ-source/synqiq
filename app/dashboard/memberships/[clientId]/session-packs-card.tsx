import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type SessionPackRow = {
  id: string;
  name: string;
  kind: "pt" | "intro" | "class";
  total: number;
  remaining: number;
  booked: number;
  expiresOn: string | null;
  source: "mindbody" | "synqiq";
};

const KIND: Record<SessionPackRow["kind"], string> = { pt: "PT", intro: "Intro", class: "Class pack" };
const day = (date: string | null) =>
  date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) : "—";

// SynqIQ's own session balances (what booking and close-out use): opening
// balance from Mindbody until the switch, or sold in SynqIQ, minus sessions
// used in SynqIQ.
export function SessionPacksCard({ packs, today }: { packs: SessionPackRow[]; today: string }) {
  const shown = packs.filter((pack) => pack.remaining > 0 || pack.booked > 0);
  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle>Session balances</CardTitle>
        <CardDescription>
          What SynqIQ counts for PT, intro and class packs. Booking a session holds one; completing it, a no-show or a late cancel uses one.
        </CardDescription>
      </CardHeader>
      {shown.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-muted-foreground">No sessions left on this account.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pack</TableHead>
                <TableHead className="text-right">Left</TableHead>
                <TableHead className="text-right">Booked</TableHead>
                <TableHead className="text-right">Free</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>From</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((pack) => {
                const expired = Boolean(pack.expiresOn && pack.expiresOn < today);
                return (
                  <TableRow key={pack.id}>
                    <TableCell>
                      <span className="font-medium">{pack.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {KIND[pack.kind]} · {pack.total} sessions
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{pack.remaining}</TableCell>
                    <TableCell className="text-right tabular-nums">{pack.booked || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.max(0, pack.remaining - pack.booked)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {day(pack.expiresOn)} {expired ? <Badge variant="outline">Expired</Badge> : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {pack.source === "mindbody" ? "Mindbody" : "Sold in SynqIQ"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
