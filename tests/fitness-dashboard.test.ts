import { describe, expect, it } from "vitest";
import {
  creditsFor,
  perTrainer,
  projectMonth,
  ptSales,
  sellerGroup,
  sessionsByDay,
  sessionsInItem,
  trainerAverages,
  type PtLine,
  type Seller,
  type TrainerSession,
} from "@/lib/dashboard/fitness-math";

const sellers = new Map<string, Seller>([
  ["t1", { id: "t1", name: "Tara Trainer", role: "staff", isTrainer: true }],
  ["t2", { id: "t2", name: "Tom Trainer", role: "staff", isTrainer: true }],
  ["s1", { id: "s1", name: "Sam Sales", role: "sales", isTrainer: true }],
  ["d1", { id: "d1", name: "Dana Desk", role: "staff", isTrainer: false }],
]);

const line = (over: Partial<PtLine>): PtLine => ({
  lineId: "l",
  saleNumber: 1,
  day: "2026-11-05",
  client: "Pat",
  name: "Base 8 PT (50)",
  quantity: 1,
  amountCents: 96000,
  sessions: 8,
  rangUpBy: "d1",
  credits: [],
  ...over,
});

describe("sessionsInItem", () => {
  it("uses the catalog count, else the number in a PT membership's name", () => {
    expect(sessionsInItem("Base 12 PT (25)", 12)).toBe(12);
    expect(sessionsInItem("12  PT   (50)", null)).toBe(12);
    expect(sessionsInItem("Semi-Private PT  8", null)).toBe(8);
    expect(sessionsInItem("Training gift card", null)).toBeNull();
    expect(sessionsInItem("Unlimited", 99999)).toBeNull();
  });
});

describe("seller groups and credit", () => {
  it("puts Sales and Sales Leads in the sales team even if they train", () => {
    expect(sellerGroup(sellers.get("s1"))).toBe("sales");
    expect(sellerGroup(sellers.get("t1"))).toBe("trainers");
    expect(sellerGroup(sellers.get("d1"))).toBe("other");
    expect(sellerGroup(undefined)).toBe("other");
  });

  it("credits the commission split, else whoever rang it up", () => {
    expect(creditsFor({ rangUpBy: "d1", credits: [] })).toEqual([["d1", 1]]);
    expect(
      creditsFor({
        rangUpBy: "d1",
        credits: [
          { staffId: "t1", share: 50 },
          { staffId: "s1", share: 50 },
        ],
      }),
    ).toEqual([
      ["t1", 0.5],
      ["s1", 0.5],
    ]);
  });
});

describe("ptSales", () => {
  it("totals revenue, average session rate and the trainer vs sales split", () => {
    const summary = ptSales(
      [
        line({ lineId: "a", credits: [{ staffId: "t1", share: 100 }] }), // $960 / 8
        line({ lineId: "b", name: "PT 60 Single Session (add-on)", amountCents: 14000, sessions: 1, quantity: 2, rangUpBy: "s1" }), // $140 x2 sessions
        line({ lineId: "c", name: "Assessment and Intro Workout", amountCents: 0, sessions: 1, rangUpBy: "t2" }), // free: no rate
      ],
      sellers,
    );
    expect(summary.totalCents).toBe(110000);
    expect(summary.sessionsSold).toBe(10);
    expect(summary.avgSessionCents).toBe(11000);
    const trainers = summary.groups.find((group) => group.group === "trainers")!;
    const sales = summary.groups.find((group) => group.group === "sales")!;
    expect(trainers.cents).toBe(96000);
    expect(trainers.avgSessionCents).toBe(12000);
    expect(sales.cents).toBe(14000);
    expect(sales.sessions).toBe(2);
    expect(summary.groups.some((group) => group.group === "other")).toBe(false);
  });
});

const session = (over: Partial<TrainerSession>): TrainerSession => ({
  id: "x",
  trainerId: "t1",
  client: "Pat",
  clientId: "100",
  type: "PT 60",
  typeId: 1,
  day: "2026-11-02",
  startsAt: "2026-11-02T15:00:00Z",
  status: "completed",
  ...over,
});

describe("sessions", () => {
  const sessions = [
    session({ id: "1" }),
    session({ id: "2", status: "no_show" }),
    session({ id: "3", status: "cancelled" }),
    session({ id: "4", status: "late_cancelled", day: "2026-11-03" }),
    session({ id: "5", status: "booked", day: "2026-11-03", trainerId: "t2" }),
  ];

  it("counts scheduled (not cancelled ahead) and completed day by day", () => {
    const days = sessionsByDay(sessions, "2026-11-01", "2026-11-03");
    expect(days.map((row) => [row.day, row.scheduled, row.completed])).toEqual([
      ["2026-11-01", 0, 0],
      ["2026-11-02", 2, 1],
      ["2026-11-03", 2, 0],
    ]);
    expect(days[2].lateCancel).toBe(1);
    expect(days[2].open).toBe(1);
  });

  it("averages serviced sessions and PT sales over active trainers", () => {
    const sales = ptSales([line({ credits: [{ staffId: "t2", share: 100 }] })], sellers);
    const rows = perTrainer(sessions, sales, new Map([...sellers].filter(([, seller]) => seller.isTrainer && seller.role === "staff")));
    expect(rows.map((row) => [row.staffId, row.scheduled, row.completed, row.salesCents])).toEqual([
      ["t1", 3, 1, 0],
      ["t2", 1, 0, 96000],
    ]);
    expect(trainerAverages(rows)).toEqual({ trainers: 2, sessions: 0.5, salesCents: 48000 });
    expect(trainerAverages([])).toEqual({ trainers: 0, sessions: null, salesCents: null });
  });
});

describe("projectMonth", () => {
  it("projects a straight line to month end, today included", () => {
    expect(projectMonth(60, "2026-11-15")).toEqual({ projected: 120, daysGone: 15, daysInMonth: 30 });
    expect(projectMonth(0, "2026-11-01").projected).toBe(0);
  });
});
