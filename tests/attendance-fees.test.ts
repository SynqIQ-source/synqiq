import { describe, expect, it } from "vitest";
import { feeTotals, type FeeRow } from "@/lib/booking/fees";

const row = (status: FeeRow["status"], feeCents: number): FeeRow => ({
  id: `${status}-${feeCents}`,
  clientId: "1",
  name: "Member",
  status,
  feeCents,
  className: "Pool Lane 1",
  startsAt: "2026-11-18T12:00:00Z",
});

describe("no-show and late-cancel fee totals", () => {
  it("counts each kind and adds up the fees", () => {
    expect(feeTotals([row("no_show", 2000), row("late_cancelled", 2000), row("late_cancelled", 0)])).toEqual({
      noShows: 1,
      lateCancels: 2,
      feeCents: 4000,
    });
  });
});
