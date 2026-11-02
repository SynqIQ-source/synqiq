// SynqIQ's modules and pricing (the public /pricing page and the Studios
// page). Each studio turns on the modules it pays for (org_modules); the
// monthly price follows from how many are on, unless the studio has a
// custom price (organizations.custom_monthly_price).

export const MODULES = [
  {
    key: "group_fitness",
    name: "Group Fitness",
    price: 150,
    summary: "Sub coverage and member follow-up for group classes.",
    features: [
      "Sub requests routed to qualified instructors",
      "Class schedule synced from Mindbody",
      "Instructor follow-up emails to members after class",
      "Fill rate, attendance and heat map reports",
    ],
  },
  {
    key: "trainer",
    name: "Trainer",
    price: 150,
    summary: "Personal training productivity and new-member handoff.",
    features: [
      "Trainer Health: sessions and PT revenue per trainer",
      "PT sales credited to the trainer who trains the client",
      "New members assigned to trainers for an intro",
      "Early warning when a trainer falls under benchmark",
    ],
  },
  {
    key: "crm",
    name: "Sales CRM",
    price: 200,
    summary: "Guest check-in, leads and follow-up, built for gyms.",
    features: [
      "iPad check-in kiosk with waivers",
      "Lead follow-up cadence and overdue tracking",
      "Texting, email and call logging",
      "Sales dashboard, calendar and lead reports",
    ],
  },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];

export const BUNDLE_PRICES: Record<number, number> = { 2: 299, 3: 399 };
export const TEXTS_INCLUDED = 1000;
export const TEXT_OVERAGE = 0.03;

export function isModuleKey(value: unknown): value is ModuleKey {
  return MODULES.some((module) => module.key === value);
}

// List price for a set of modules: one module at its own price, two or
// three at the bundle price.
export function listPrice(modules: ModuleKey[]): number {
  const unique = [...new Set(modules)];
  if (unique.length === 0) return 0;
  if (unique.length === 1) return MODULES.find((module) => module.key === unique[0])!.price;
  return BUNDLE_PRICES[unique.length] ?? BUNDLE_PRICES[3];
}
