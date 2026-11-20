import { describe, expect, it } from "vitest";
import { cleanDomain, fromAddress, onDomains } from "@/lib/email/domains";

describe("studio email domains", () => {
  it("cleans what an admin types", () => {
    expect(cleanDomain(" https://Reply.ThePreserveHouston.com/ ")).toBe("reply.thepreservehouston.com");
    expect(cleanDomain("thepreservehouston.com")).toBe("thepreservehouston.com");
    expect(cleanDomain("not a domain")).toBeNull();
    expect(cleanDomain("localhost")).toBeNull();
  });

  it("sends from the studio domain only when given one", () => {
    expect(fromAddress('The "Preserve"', "thepreservehouston.com")).toBe("The Preserve <notifications@thepreservehouston.com>");
    expect(fromAddress("The Preserve", null)).toBe("The Preserve <notifications@synqiq.co>");
  });

  it("accepts replies on any relay domain", () => {
    const domains = ["followup.synqiq.co", "reply.thepreservehouston.com"];
    expect(onDomains("abc@Reply.ThePreserveHouston.com", domains)).toBe(true);
    expect(onDomains("abc@followup.synqiq.co", domains)).toBe(true);
    expect(onDomains("abc@thepreservehouston.com", domains)).toBe(false);
  });
});
