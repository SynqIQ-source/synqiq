import { describe, expect, it } from "vitest";
import { dottedGmail, looksRandom, spamCheck } from "@/lib/crm/spam";

describe("looksRandom", () => {
  it("flags bot strings", () => {
    expect(looksRandom("Rgnbsqn")).toBe(true);
    expect(looksRandom("xILGzbDrgSUsrgUtqSaJxBsF")).toBe(true);
  });
  it("keeps real names", () => {
    for (const name of [
      "Aariel",
      "McDonald",
      "DeAndre",
      "Schiro",
      "Watlington",
      "Nguyen",
      "Brodie",
      "Shackleton",
      "Strzelecki",
      "Lynn",
      "Bryn",
    ])
      expect([name, looksRandom(name)]).toEqual([name, false]);
  });
});

describe("dottedGmail", () => {
  it("spots padded Gmail addresses", () => {
    expect(dottedGmail("e.huk.ub.e.la.0.66@gmail.com")).toBe(true);
    expect(dottedGmail("jane.doe@gmail.com")).toBe(false);
    expect(dottedGmail("a.b.c.d@company.com")).toBe(false);
  });
});

describe("spamCheck", () => {
  it("catches the bot submission from Nov 15", () => {
    const verdict = spamCheck({
      firstName: "Rgnbsqn",
      lastName: "",
      email: "e.huk.ub.e.la.0.66@gmail.com",
      message: "xILGzbDrgSUsrgUtqSaJxBsF",
    });
    expect(verdict.spam).toBe(true);
    expect(verdict.reasons).toHaveLength(3);
  });
  it("lets a real enquiry through", () => {
    expect(
      spamCheck({ firstName: "Jane", lastName: "Doe", email: "jane.doe@gmail.com", message: "Do you offer a trial week for the pool?" })
        .spam,
    ).toBe(false);
  });
  it("one odd signal alone isn't enough", () => {
    expect(
      spamCheck({ firstName: "Xzyptl", lastName: "Smith", email: "x@company.com", message: "Interested in personal training" }).spam,
    ).toBe(false);
  });
});
