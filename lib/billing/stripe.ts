import Stripe from "stripe";
import { getEnv } from "@/lib/env";
import { listPrice, MODULES, type ModuleKey } from "@/lib/plans";

// Stripe for SynqIQ's own billing (studios paying for SynqIQ). One
// subscription per studio with a single monthly price for its plan: a
// module on its own, any two, or all three (lib/plans.ts). Prices are found
// by lookup key and created the first time they're needed, so the numbers
// in lib/plans.ts are the only place prices are set.

// Stripe's tax code for business-use SaaS, as set on the existing products.
export const SAAS_TAX_CODE = "txcd_10103001";
const PRODUCT_LOOKUP = "synqiq_plan";

// Pinned so a library upgrade never silently changes API behavior; this is
// the version stripe@23.0.0 defaults to. Bump deliberately, with testing.
export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

let client: Stripe | null = null;
export function getStripe(): Stripe {
  client ??= new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: STRIPE_API_VERSION });
  return client;
}

// "synqiq_plan_group_fitness", "synqiq_plan_two", "synqiq_plan_three".
function planLookupKey(modules: ModuleKey[]): string {
  const unique = [...new Set(modules)];
  if (unique.length === 1) return `${PRODUCT_LOOKUP}_${unique[0]}`;
  return unique.length === 2 ? `${PRODUCT_LOOKUP}_two` : `${PRODUCT_LOOKUP}_three`;
}

function planName(modules: ModuleKey[]): string {
  const unique = [...new Set(modules)];
  if (unique.length === 1) return MODULES.find((module) => module.key === unique[0])!.name;
  return unique.length === 2 ? "Any two modules" : "All three modules";
}

async function planProduct(stripe: Stripe): Promise<string> {
  const found = await stripe.products.search({ query: `metadata['synqiq']:'${PRODUCT_LOOKUP}'`, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const product = await stripe.products.create({
    name: "SynqIQ",
    description: "SynqIQ for fitness studios: Group Fitness, Trainer and Sales CRM modules.",
    tax_code: SAAS_TAX_CODE,
    metadata: { synqiq: PRODUCT_LOOKUP },
  });
  return product.id;
}

// The monthly Stripe price for a set of modules (created if missing, or
// replaced if lib/plans.ts changed the amount).
export async function planPriceId(modules: ModuleKey[]): Promise<string> {
  if (modules.length === 0) throw new Error("A plan needs at least one module.");
  const stripe = getStripe();
  const lookupKey = planLookupKey(modules);
  const amount = Math.round(listPrice(modules) * 100);
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (existing.data[0]?.unit_amount === amount) return existing.data[0].id;
  const price = await stripe.prices.create({
    product: await planProduct(stripe),
    currency: "usd",
    unit_amount: amount,
    recurring: { interval: "month" },
    nickname: planName(modules),
    lookup_key: lookupKey,
    // Moves the lookup key off an old price if the amount changed.
    transfer_lookup_key: true,
    tax_behavior: "exclusive",
    // The studio's modules live in Synq; "two" is shared by every pair.
    metadata: { synqiq_plan: lookupKey },
  });
  return price.id;
}
