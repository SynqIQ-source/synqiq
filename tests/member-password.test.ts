import { describe, expect, it } from "vitest";
import {
  afterFailedAttempt,
  hashPassword,
  hashToken,
  looksLikeEmail,
  newToken,
  passwordProblem,
  verifyPassword,
} from "@/lib/member/password";

describe("member passwords", () => {
  it("hashes with a salt and verifies only the right password", async () => {
    const first = await hashPassword("correct horse battery");
    const second = await hashPassword("correct horse battery");
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toEqual(second);
    expect(await verifyPassword("correct horse battery", first)).toBe(true);
    expect(await verifyPassword("correct horse batterY", first)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });

  it("asks for a reasonable password", () => {
    expect(passwordProblem("short", "a@b.co")).toMatch(/10 characters/);
    expect(passwordProblem("aaaaaaaaaaaa", "a@b.co")).toMatch(/harder/);
    expect(passwordProblem("Me@Example.com", "me@example.com")).toMatch(/email/);
    expect(passwordProblem("swim lanes at six", "me@example.com")).toBeNull();
  });

  it("stores only a hash of tokens", () => {
    const { token, hash } = newToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hash).toEqual(hashToken(token));
    expect(hash).not.toContain(token);
  });

  it("locks after five wrong passwords in a row", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(afterFailedAttempt(0, now)).toEqual({ failedAttempts: 1, lockedUntil: null });
    expect(afterFailedAttempt(4, now)).toEqual({ failedAttempts: 0, lockedUntil: "2026-11-11T12:15:00.000Z" });
  });

  it("checks email shape", () => {
    expect(looksLikeEmail("paige@example.com")).toBe(true);
    expect(looksLikeEmail("paige@example")).toBe(false);
    expect(looksLikeEmail("pa ige@example.com")).toBe(false);
  });
});
