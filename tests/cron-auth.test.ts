import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCronRequest } from "@/lib/cron-auth";

const request = (authorization?: string) =>
  new Request("https://synqiq.test/api/sync/all", authorization ? { headers: { authorization } } : undefined);

describe("isCronRequest", () => {
  const previous = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });
  afterEach(() => {
    process.env.CRON_SECRET = previous;
  });

  it("accepts the exact bearer secret", () => {
    expect(isCronRequest(request("Bearer test-secret"))).toBe(true);
  });

  it("rejects missing, wrong, or near-miss secrets", () => {
    expect(isCronRequest(request())).toBe(false);
    expect(isCronRequest(request("Bearer wrong"))).toBe(false);
    expect(isCronRequest(request("test-secret"))).toBe(false);
    expect(isCronRequest(request("bearer test-secret"))).toBe(false);
    expect(isCronRequest(request("Bearer test-secret-and-more"))).toBe(false);
  });
});
