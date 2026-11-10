import { describe, expect, it } from "vitest";
import { buildQueue } from "@/lib/sync/member-profile-nightly";

describe("nightly member refresh queue", () => {
  const fresh = "2026-11-10T00:00:00.000Z";
  it("never-pulled first, then recently active, then the oldest seventh; skips anyone fresh", () => {
    const members = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"];
    const synced = new Map<string, string>([
      ["b", "2026-11-01T00:00:00.000Z"],
      ["c", "2026-11-02T00:00:00.000Z"],
      ["d", "2026-11-10T05:00:00.000Z"], // fresh
      ["e", "2026-11-03T00:00:00.000Z"],
      ["f", "2026-11-04T00:00:00.000Z"],
      ["g", "2026-11-05T00:00:00.000Z"],
      ["h", "2026-11-06T00:00:00.000Z"],
      ["i", "2026-11-07T00:00:00.000Z"],
      ["j", "2026-11-07T00:00:00.000Z"],
      ["k", "2026-11-07T00:00:00.000Z"],
      ["l", "2026-11-07T00:00:00.000Z"],
      ["m", "2026-11-07T00:00:00.000Z"],
      ["n", "2026-11-07T00:00:00.000Z"],
    ]);
    const queue = buildQueue(members, synced, new Set(["g", "d"]), fresh);
    expect(queue).toEqual(["a", "g", "b", "c"]); // 14 members -> a seventh is 2
  });
});
