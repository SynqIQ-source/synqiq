import type { SupabaseClient } from "@supabase/supabase-js";

// Which Mindbody contracts are memberships and which items sold are PT, per
// studio (mindbody_item_types). Names are recorded as Synq sees them; each
// counts by a guess from its name unless an admin has set it on Settings ->
// Mindbody items.

export type ItemKind = "contract" | "sale_item";

// Memberships: "Membership", "Commitment", "Annual" -- but not PT, training
// or private/semi-private packages. ("Unlimited" class packs are left for an
// admin to tick.)
const MEMBERSHIP = /membership|commitment|annual/i;
const PT = /\bpt\b|personal training|semi[- ]?private|private pilates|small group training|training pack/i;

export function guessCounts(kind: ItemKind, name: string): boolean {
  return kind === "contract" ? MEMBERSHIP.test(name) && !PT.test(name) : PT.test(name);
}

const clean = (name: string) => name.replace(/\s+/g, " ").trim();

// Records names Synq has seen (new ones get counted by their guess).
export async function recordItemNames(admin: SupabaseClient, organizationId: string, kind: ItemKind, names: string[]) {
  const unique = [...new Set(names.map(clean).filter(Boolean))];
  if (unique.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await admin.from("mindbody_item_types").upsert(
    unique.map((name) => ({ organization_id: organizationId, kind, name, last_seen_at: now })),
    { onConflict: "organization_id,kind,name" },
  );
  if (error) throw error;
}

// name -> counts, for one kind, with admin overrides applied.
export async function loadItemClassifier(
  client: SupabaseClient,
  organizationId: string,
  kind: ItemKind,
): Promise<(name: string | null | undefined) => boolean> {
  const { data, error } = await client
    .from("mindbody_item_types")
    .select("name, counts")
    .eq("organization_id", organizationId)
    .eq("kind", kind);
  if (error) throw error;
  const overrides = new Map(
    (data ?? []).filter((row) => row.counts !== null).map((row) => [row.name as string, row.counts as boolean]),
  );
  return (name) => {
    if (!name) return false;
    const key = clean(name);
    return overrides.get(key) ?? guessCounts(kind, key);
  };
}
