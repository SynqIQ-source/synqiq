import { DateTime } from "luxon";

// Fitness Dashboard math: pure, so the page and the tests share it. Built on
// SynqIQ's own records only: trainer sessions booked in SynqIQ and personal
// training sold at SynqIQ's checkout. Dates are the studio's local days
// ("yyyy-MM-dd").

// --- PT sales ------------------------------------------------------------------

export type SellerGroup = "trainers" | "sales" | "other";
export const SELLER_GROUP_LABELS: Record<SellerGroup, string> = {
  trainers: "Trainers",
  sales: "Sales team",
  other: "Other staff",
};

export type Seller = { id: string; name: string; role: string; isTrainer: boolean };

// Sales and Sales Leads are the sales team (even if they also train);
// otherwise a trainer is a trainer; anyone else (front desk, admins who
// don't train) is "other".
export function sellerGroup(seller: Pick<Seller, "role" | "isTrainer"> | undefined): SellerGroup {
  if (!seller) return "other";
  if (seller.role === "sales" || seller.role === "sales_lead") return "sales";
  return seller.isTrainer ? "trainers" : "other";
}

export type PtLine = {
  lineId: string;
  saleNumber: number;
  day: string;
  client: string;
  name: string; // what was sold
  quantity: number;
  amountCents: number; // before tax, after discounts
  sessions: number | null; // sessions in one of this item (null = unknown)
  rangUpBy: string; // staff id
  credits: { staffId: string; share: number }[]; // commission split chosen at checkout (percent)
};

// Sessions in a PT item: the catalog's count for packs; for monthly PT
// memberships ("12 PT (50)", "Semi-Private PT 8") the number in the name.
export function sessionsInItem(name: string, catalogSessions: number | null): number | null {
  if (catalogSessions != null && catalogSessions > 0 && catalogSessions < 1000) return catalogSessions;
  const match = /(?:^|\s)(\d{1,3})\s+PT\b/i.exec(name) ?? /\bPT\s+(\d{1,3})\s*$/i.exec(name.trim());
  return match ? Number(match[1]) : null;
}

// Who gets credit for a line: the commission split chosen at checkout, else
// whoever rang it up. Shares are percents; returns [staffId, fraction].
export function creditsFor(line: Pick<PtLine, "credits" | "rangUpBy">): [string, number][] {
  const credits = line.credits.filter((credit) => credit.share > 0);
  if (!credits.length) return [[line.rangUpBy, 1]];
  return credits.map((credit) => [credit.staffId, credit.share / 100]);
}

export type PtSalesSummary = {
  totalCents: number;
  sessionsSold: number; // on priced lines with a known session count
  avgSessionCents: number | null;
  groups: { group: SellerGroup; cents: number; sessions: number; avgSessionCents: number | null }[];
  people: { staffId: string; name: string; group: SellerGroup; cents: number; sessions: number }[];
};

export function ptSales(lines: PtLine[], sellers: Map<string, Seller>): PtSalesSummary {
  const people = new Map<string, { cents: number; sessions: number; pricedCents: number }>();
  let totalCents = 0;
  let sessionsSold = 0;
  let pricedCents = 0;
  for (const line of lines) {
    totalCents += line.amountCents;
    const sessions = line.sessions != null && line.amountCents > 0 ? line.sessions * line.quantity : 0;
    if (sessions) {
      sessionsSold += sessions;
      pricedCents += line.amountCents;
    }
    for (const [staffId, fraction] of creditsFor(line)) {
      const row = people.get(staffId) ?? { cents: 0, sessions: 0, pricedCents: 0 };
      row.cents += line.amountCents * fraction;
      row.sessions += sessions * fraction;
      if (sessions) row.pricedCents += line.amountCents * fraction;
      people.set(staffId, row);
    }
  }
  const peopleRows = [...people.entries()]
    .map(([staffId, row]) => {
      const seller = sellers.get(staffId);
      return {
        staffId,
        name: seller?.name ?? "Unknown staff",
        group: sellerGroup(seller),
        cents: Math.round(row.cents),
        sessions: Math.round(row.sessions * 10) / 10,
        pricedCents: row.pricedCents,
      };
    })
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  const groups = (["trainers", "sales", "other"] as SellerGroup[])
    .map((group) => {
      const mine = peopleRows.filter((row) => row.group === group);
      const cents = mine.reduce((sum, row) => sum + row.cents, 0);
      const sessions = Math.round(mine.reduce((sum, row) => sum + row.sessions, 0) * 10) / 10;
      const priced = mine.reduce((sum, row) => sum + row.pricedCents, 0);
      return { group, cents, sessions, avgSessionCents: sessions > 0 ? Math.round(priced / sessions) : null };
    })
    .filter((row) => row.group !== "other" || row.cents !== 0);
  return {
    totalCents,
    sessionsSold,
    avgSessionCents: sessionsSold > 0 ? Math.round(pricedCents / sessionsSold) : null,
    groups,
    people: peopleRows.map((row) => ({ staffId: row.staffId, name: row.name, group: row.group, cents: row.cents, sessions: row.sessions })),
  };
}

// --- sessions --------------------------------------------------------------------

export type TrainerSession = {
  id: string;
  trainerId: string;
  client: string;
  clientId: string;
  type: string;
  typeId: number | null;
  day: string;
  startsAt: string;
  status: string; // booked | completed | no_show | cancelled | late_cancelled
};

export type DayRow = { day: string; scheduled: number; completed: number; noShow: number; lateCancel: number; open: number };

// Scheduled = every session on the books that wasn't cancelled ahead of time
// (completed, no-shows, late cancels and still-open bookings). Completed =
// marked completed ("serviced").
export const isScheduled = (status: string) => status !== "cancelled";

export function sessionsByDay(sessions: TrainerSession[], from: string, to: string): DayRow[] {
  const rows: DayRow[] = [];
  for (let day = DateTime.fromISO(from); day.toISODate()! <= to; day = day.plus({ days: 1 })) {
    const key = day.toISODate()!;
    const mine = sessions.filter((session) => session.day === key && isScheduled(session.status));
    rows.push({
      day: key,
      scheduled: mine.length,
      completed: mine.filter((session) => session.status === "completed").length,
      noShow: mine.filter((session) => session.status === "no_show").length,
      lateCancel: mine.filter((session) => session.status === "late_cancelled").length,
      open: mine.filter((session) => session.status === "booked").length,
    });
  }
  return rows;
}

export const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// --- goals and pace ------------------------------------------------------------

// Straight-line projection: what's done so far, spread over the days gone
// (today counts), carried to the end of the month.
export function projectMonth(actual: number, today: string) {
  const day = DateTime.fromISO(today);
  const daysGone = day.day;
  const daysInMonth = day.daysInMonth!;
  return { projected: Math.round((actual / daysGone) * daysInMonth), daysGone, daysInMonth };
}

// --- per trainer -----------------------------------------------------------------

export type TrainerRow = {
  staffId: string;
  name: string;
  scheduled: number;
  completed: number;
  salesCents: number;
  sessionsSold: number;
};

// Every trainer with sessions on the books or PT sales credited this month.
export function perTrainer(sessions: TrainerSession[], sales: PtSalesSummary, trainers: Map<string, Seller>): TrainerRow[] {
  const rows = new Map<string, TrainerRow>();
  const row = (staffId: string) => {
    let existing = rows.get(staffId);
    if (!existing) {
      existing = {
        staffId,
        name: trainers.get(staffId)?.name ?? "Unknown trainer",
        scheduled: 0,
        completed: 0,
        salesCents: 0,
        sessionsSold: 0,
      };
      rows.set(staffId, existing);
    }
    return existing;
  };
  for (const session of sessions) {
    if (!isScheduled(session.status)) continue;
    const mine = row(session.trainerId);
    mine.scheduled += 1;
    if (session.status === "completed") mine.completed += 1;
  }
  for (const person of sales.people) {
    if (!trainers.has(person.staffId)) continue;
    const mine = row(person.staffId);
    mine.salesCents += person.cents;
    mine.sessionsSold += person.sessions;
  }
  return [...rows.values()].sort((a, b) => b.completed - a.completed || b.salesCents - a.salesCents || a.name.localeCompare(b.name));
}

// Mean per trainer, over the trainers in `rows`.
export function trainerAverages(rows: TrainerRow[]) {
  if (!rows.length) return { trainers: 0, sessions: null, salesCents: null };
  return {
    trainers: rows.length,
    sessions: Math.round((rows.reduce((sum, row) => sum + row.completed, 0) / rows.length) * 10) / 10,
    salesCents: Math.round(rows.reduce((sum, row) => sum + row.salesCents, 0) / rows.length),
  };
}
