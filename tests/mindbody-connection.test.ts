import { afterEach, describe, expect, it } from "vitest";
import { MindbodyDisconnectedError, mindbodyGloballyDisabled } from "@/lib/mindbody/connection";

describe("Mindbody off switch", () => {
  afterEach(() => {
    delete process.env.MINDBODY_DISABLED;
  });

  it("can be switched off everywhere", () => {
    expect(mindbodyGloballyDisabled()).toBe(false);
    process.env.MINDBODY_DISABLED = "true";
    expect(mindbodyGloballyDisabled()).toBe(true);
  });

  it("names the site it refused", () => {
    const error = new MindbodyDisconnectedError("561843");
    expect(error.message).toContain("561843");
    expect(error.name).toBe("MindbodyDisconnectedError");
  });
});
