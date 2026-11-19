// No-show and late-cancel fees recorded on class and pool lane bookings
// (the No-shows & Late Cancels report).

export type FeeRow = {
  id: string;
  clientId: string;
  name: string;
  status: "no_show" | "late_cancelled";
  feeCents: number;
  className: string;
  startsAt: string;
};

export function feeTotals(rows: FeeRow[]) {
  return {
    noShows: rows.filter((row) => row.status === "no_show").length,
    lateCancels: rows.filter((row) => row.status === "late_cancelled").length,
    feeCents: rows.reduce((sum, row) => sum + Math.max(0, row.feeCents), 0),
  };
}
