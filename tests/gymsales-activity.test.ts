import { describe, expect, it } from "vitest";
import { buildNameIndex, nameKey, parseCalls, parseMessages } from "@/lib/crm/gymsales-activity";

const TZ = "America/Chicago";

describe("Gym Sales activity reports", () => {
  it("reads calls under their day headers, in the studio's time", () => {
    const calls = parseCalls(
      [
        { "Person Name": "Monday 16 November 2026", Time: null },
        {
          "Person Name": "Pat Example",
          Time: "11:24 am",
          "Call Outcome": "Left Message",
          "Call Description": "VM",
          "Next Action": "Follow Up",
        },
        { "Person Name": "Tuesday 17 November 2026", Time: null },
        { "Person Name": "Lee Sample", Time: "01:13 pm", "Call Outcome": "Spoke to", "Call Description": null },
      ],
      TZ,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      kind: "call",
      direction: "outbound",
      at: "2026-11-16T17:24:00.000Z",
      outcome: "Left Message",
      body: "VM",
    });
    expect(calls[1].at).toBe("2026-11-17T19:13:00.000Z");
  });

  it("reads texts both ways and emails", () => {
    const sms = parseMessages(
      [
        { Direction: "Inbound", "Person Name": "Pat Example", "Date & Time": "05/16/2026 11:10 am", Message: "yes!", "Send By": "Roy" },
        { Direction: "Outbound", "Person Name": "Pat Example", "Date & Time": "05/16/2026 02:17 pm", Message: "Hi Pat", "Send By": "Roy" },
      ],
      "sms",
      TZ,
    );
    expect(sms.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
    expect(sms[0].sentBy).toBeNull();
    expect(sms[1].sentBy).toBe("Roy");
    expect(sms[0].sourceKey).not.toBe(sms[1].sourceKey);
    const again = parseMessages(
      [{ Direction: "Inbound", "Person Name": "Pat Example", "Date & Time": "05/16/2026 11:10 am", Message: "yes!" }],
      "sms",
      TZ,
    );
    expect(again[0].sourceKey).toBe(sms[0].sourceKey);
  });

  it("matches by name only when exactly one lead has it", () => {
    const match = buildNameIndex([
      { id: "a", first_name: "Conor", last_name: "McEvily" },
      { id: "b", first_name: "Sam", last_name: "Lee" },
      { id: "c", first_name: "Sam", last_name: "Lee" },
      { id: "d", first_name: "José", last_name: "Núñez" },
    ]);
    expect(match("Conor P McEvily")).toEqual({ id: "a" });
    expect(match("conor mcevily")).toEqual({ id: "a" });
    expect(match("Sam Lee")).toEqual({ ambiguous: true });
    expect(match("Jose Nunez")).toEqual({ id: "d" });
    expect(match("Nobody Here")).toBeNull();
    expect(nameKey("  O'Brien-Smith ")).toBe("o brien smith");
  });
});
