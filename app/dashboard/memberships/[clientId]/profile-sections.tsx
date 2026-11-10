import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isUnlimited, type MemberPersonal } from "@/lib/memberships/profile";

// Read-only sections of a member's page built from Mindbody's client data
// (member_visits / member_sales / member_services / member_profile_sync).

export type VisitRow = {
  id: string;
  kind: "arrival" | "class" | "appointment" | "other";
  name: string;
  start_local: string;
  end_local: string | null;
  service_name: string | null;
  staff_mindbody_id: number | null;
  appointment_status: string | null;
  signed_in: boolean | null;
  late_cancelled: boolean | null;
  missed: boolean | null;
};
export type SaleRow = {
  mindbody_sale_id: number;
  sale_at: string | null;
  total_cents: number;
  sales_rep_mindbody_id: number | null;
  payments: { method: number | null; type: string | null; amountCents: number | null }[];
};
export type SaleItemRow = {
  mindbody_sale_id: number;
  mindbody_sale_detail_id: number;
  description: string;
  quantity: number | null;
  unit_price_cents: number | null;
  discount_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  returned: boolean;
};
export type ServiceRow = {
  id: string;
  name: string;
  program: string | null;
  count: number | null;
  remaining: number | null;
  is_current: boolean | null;
  active_date: string | null;
  expiration_date: string | null;
  payment_date: string | null;
};

const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? "—"
    : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const day = (iso: string | null | undefined) => (iso ? DateTime.fromISO(iso).toFormat("LLL d, yyyy") : "—");
const when = (local: string) => DateTime.fromISO(local).toFormat("ccc, LLL d, yyyy · h:mm a");

const KIND_LABEL: Record<VisitRow["kind"], string> = {
  arrival: "Gym check-in",
  class: "Class",
  appointment: "Appointment",
  other: "Visit",
};

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm text-foreground">{children ?? "—"}</dd>
    </div>
  );
}

export function NotPulledYet({ what }: { what: string }) {
  return (
    <p className="px-6 pb-6 text-sm text-muted-foreground">
      {what} haven&apos;t been pulled from Mindbody for this member yet. Use &quot;Refresh from Mindbody&quot; at the top.
    </p>
  );
}

export function PersonalCard({
  name,
  status,
  clientId,
  memberSince,
  personal,
  fallbackEmail,
  pulledAt,
}: {
  name: string;
  status: string | null;
  clientId: string;
  memberSince: string | null;
  personal: Partial<MemberPersonal> | null;
  fallbackEmail: string | null;
  pulledAt: string | null;
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const address = [
    personal?.addressLine1,
    personal?.addressLine2,
    [personal?.city, personal?.state].filter(Boolean).join(", "),
    personal?.postalCode,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal information</CardTitle>
        <CardDescription>
          From Mindbody{pulledAt ? ` (pulled ${pulledAt})` : ""}. Mindbody keeps member details until the switch; editing moves to SynqIQ
          then.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          {personal?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Mindbody-hosted photo
            <img src={personal.photoUrl} alt="" className="h-20 w-20 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground">
              {initials}
            </span>
          )}
          <div>
            <p className="text-lg font-semibold">{name}</p>
            {status ? <Badge variant={status === "Active" ? "secondary" : "outline"}>{status}</Badge> : null}
          </div>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Item label="Email">{personal?.email ?? fallbackEmail}</Item>
          <Item label="Mobile">{personal?.mobilePhone ?? personal?.homePhone}</Item>
          <Item label="Birthday">{personal?.birthDate ? DateTime.fromISO(personal.birthDate).toFormat("LLL d, yyyy") : null}</Item>
          <Item label="Member since">{memberSince ? day(memberSince) : null}</Item>
          <Item label="Address">{address || null}</Item>
          <Item label="Emergency contact">
            {personal?.emergencyContactName
              ? `${personal.emergencyContactName}${personal.emergencyContactPhone ? ` · ${personal.emergencyContactPhone}` : ""}`
              : null}
          </Item>
          <Item label="Mindbody client ID">{clientId}</Item>
        </dl>
      </CardContent>
    </Card>
  );
}

// PT / Pilates packs and passes: sessions bought vs remaining.
export function ServicesCard({ services, pulled }: { services: ServiceRow[]; pulled: boolean }) {
  const current = services.filter((service) => service.is_current);
  const packs = current.filter((service) => !isUnlimited(service.count));
  const passes = current.filter((service) => isUnlimited(service.count));
  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle>Packs and sessions</CardTitle>
        <CardDescription>Current PT, Pilates and other session packs, with sessions used and left.</CardDescription>
      </CardHeader>
      {!pulled ? (
        <NotPulledYet what="Packs" />
      ) : current.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-muted-foreground">No current packs or passes.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pack</TableHead>
                <TableHead className="text-right">Bought</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Left</TableHead>
                <TableHead>Purchased</TableHead>
                <TableHead>Expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packs.map((service) => (
                <TableRow key={service.id}>
                  <TableCell>
                    <span className="font-medium">{service.name}</span>
                    {service.program ? <span className="block text-xs text-muted-foreground">{service.program}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{service.count ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {service.count !== null && service.remaining !== null ? service.count - service.remaining : "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{service.remaining ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(service.payment_date ?? service.active_date)}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(service.expiration_date)}</TableCell>
                </TableRow>
              ))}
              {passes.map((service) => (
                <TableRow key={service.id}>
                  <TableCell>
                    <span className="font-medium">{service.name}</span>
                    {service.program ? <span className="block text-xs text-muted-foreground">{service.program}</span> : null}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground" colSpan={3}>
                    Unlimited
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{day(service.active_date)}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(service.expiration_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function visitStatus(visit: VisitRow): { label: string; tone: "outline" | "secondary" | "destructive" } {
  if (visit.late_cancelled) return { label: "Late cancel", tone: "destructive" };
  if (visit.missed) return { label: "No-show", tone: "destructive" };
  if (visit.signed_in) return { label: "Checked in", tone: "secondary" };
  if (visit.kind === "appointment" && visit.appointment_status) return { label: visit.appointment_status, tone: "outline" };
  return { label: "Booked", tone: "outline" };
}

export function VisitsTable({
  visits,
  staffNames,
  upcoming,
  pulled,
  totalCount,
}: {
  visits: VisitRow[];
  staffNames: Map<number, string>;
  upcoming: boolean;
  pulled: boolean;
  totalCount?: number;
}) {
  if (!pulled) return <NotPulledYet what={upcoming ? "Bookings" : "Visits"} />;
  if (visits.length === 0) {
    return <p className="px-6 pb-6 text-sm text-muted-foreground">{upcoming ? "Nothing booked." : "No visits."}</p>;
  }
  return (
    <div className="max-h-[36rem] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>What</TableHead>
            <TableHead>With</TableHead>
            <TableHead>Paid with</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visits.map((visit) => {
            const status = visitStatus(visit);
            return (
              <TableRow key={visit.id}>
                <TableCell className="whitespace-nowrap">{when(visit.start_local)}</TableCell>
                <TableCell>
                  <span className="font-medium">{visit.kind === "arrival" ? "Gym check-in" : visit.name}</span>
                  <span className="block text-xs text-muted-foreground">{KIND_LABEL[visit.kind]}</span>
                </TableCell>
                <TableCell>
                  {visit.kind === "arrival" ? "—" : visit.staff_mindbody_id ? (staffNames.get(visit.staff_mindbody_id) ?? "—") : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{visit.service_name ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={status.tone}>{status.label}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {totalCount && totalCount > visits.length ? (
        <p className="px-6 py-3 text-xs text-muted-foreground">
          Showing the latest {visits.length.toLocaleString()} of {totalCount.toLocaleString()}.
        </p>
      ) : null}
    </div>
  );
}

export function VisitSummary({ visits }: { visits: VisitRow[] }) {
  const since = DateTime.now().minus({ days: 30 }).toFormat("yyyy-LL-dd'T'HH:mm:ss");
  const recent = visits.filter((visit) => visit.start_local >= since);
  const count = (kind: VisitRow["kind"]) => recent.filter((visit) => visit.kind === kind && !visit.late_cancelled && !visit.missed).length;
  const last = visits[0];
  return (
    <div className="grid grid-cols-2 gap-4 px-6 pb-4 sm:grid-cols-4">
      <Stat label="Gym check-ins (30 days)" value={count("arrival")} />
      <Stat label="Classes (30 days)" value={count("class")} />
      <Stat label="Appointments (30 days)" value={count("appointment")} />
      <Stat label="Last visit" value={last ? DateTime.fromISO(last.start_local).toFormat("LLL d") : "—"} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function PurchasesList({
  sales,
  items,
  staffNames,
  timezone,
  pulled,
}: {
  sales: SaleRow[];
  items: SaleItemRow[];
  staffNames: Map<number, string>;
  timezone: string;
  pulled: boolean;
}) {
  if (!pulled) return <NotPulledYet what="Purchases" />;
  if (sales.length === 0) return <p className="px-6 pb-6 text-sm text-muted-foreground">No purchases.</p>;
  const itemsBySale = new Map<number, SaleItemRow[]>();
  for (const item of items) itemsBySale.set(item.mindbody_sale_id, [...(itemsBySale.get(item.mindbody_sale_id) ?? []), item]);
  return (
    <ul className="divide-y border-t">
      {sales.map((sale) => {
        const lines = itemsBySale.get(sale.mindbody_sale_id) ?? [];
        const tax = lines.reduce((sum, line) => sum + (line.tax_cents ?? 0), 0);
        const discount = lines.reduce((sum, line) => sum + (line.discount_cents ?? 0), 0);
        const subtotal = lines.reduce((sum, line) => sum + (line.unit_price_cents ?? 0) * Number(line.quantity ?? 1), 0);
        const returned = lines.length > 0 && lines.every((line) => line.returned);
        const at = sale.sale_at ? DateTime.fromISO(sale.sale_at).setZone(timezone) : null;
        return (
          <li key={sale.mindbody_sale_id}>
            <details className="group px-6 py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{lines.map((line) => line.description).join(", ") || "Sale"}</span>
                  <span className="text-xs text-muted-foreground">
                    {at ? at.toFormat("LLL d, yyyy · h:mm a") : "—"}
                    {returned ? " · Returned" : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums font-medium">{money(sale.total_cents)}</span>
              </summary>
              <div className="mt-3 rounded-md border bg-muted/30 p-4 text-sm">
                <p className="font-medium">Receipt · Sale #{sale.mindbody_sale_id}</p>
                <p className="text-xs text-muted-foreground">
                  {at ? at.toFormat("cccc, LLLL d, yyyy · h:mm a") : ""}
                  {sale.sales_rep_mindbody_id && staffNames.get(sale.sales_rep_mindbody_id)
                    ? ` · Sold by ${staffNames.get(sale.sales_rep_mindbody_id)}`
                    : ""}
                </p>
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.mindbody_sale_detail_id} className={line.returned ? "text-muted-foreground line-through" : undefined}>
                        <td className="py-0.5 pr-2">
                          {line.description}
                          {line.quantity && Number(line.quantity) !== 1 ? ` × ${Number(line.quantity)}` : ""}
                        </td>
                        <td className="py-0.5 text-right tabular-nums">
                          {money((line.unit_price_cents ?? 0) * Number(line.quantity ?? 1))}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t">
                      <td className="pt-2 pr-2 text-muted-foreground">Subtotal</td>
                      <td className="pt-2 text-right tabular-nums">{money(subtotal)}</td>
                    </tr>
                    {discount ? (
                      <tr>
                        <td className="pr-2 text-muted-foreground">Discount</td>
                        <td className="text-right tabular-nums">−{money(discount)}</td>
                      </tr>
                    ) : null}
                    <tr>
                      <td className="pr-2 text-muted-foreground">Tax</td>
                      <td className="text-right tabular-nums">{money(tax)}</td>
                    </tr>
                    <tr className="font-semibold">
                      <td className="pr-2">Total</td>
                      <td className="text-right tabular-nums">{money(sale.total_cents)}</td>
                    </tr>
                    {sale.payments.map((payment, index) => (
                      <tr key={index} className="text-muted-foreground">
                        <td className="pr-2">Paid · {payment.type ?? "Payment"}</td>
                        <td className="text-right tabular-nums">{money(payment.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted-foreground">
                  Refunds for Mindbody sales are done in Mindbody until the switch. SynqIQ purchases will have a Refund button here (Club
                  Admin any amount, Sales Lead up to $400, Sales up to $100).
                </p>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
