import type { MindbodyClientRecord } from "@/types/mindbody";

// Which emails are kept: members who checked in to a class (the follow-up
// relay), and current or former members who said yes to promotional emails
// in Mindbody (newsletters, Adam 2026-11-19). Prospects' addresses are never
// kept -- leads and guests reach newsletters through the CRM instead.
export function keepEmail(client: Pick<MindbodyClientRecord, "UniqueId" | "Status" | "SendPromotionalEmails">, checkedInIds: Set<number>) {
  if (checkedInIds.has(client.UniqueId)) return true;
  return client.SendPromotionalEmails === true && Boolean(client.Status) && client.Status !== "Non-Member";
}
