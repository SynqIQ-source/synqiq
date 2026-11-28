// The Preserve's visit categories, shown on the class roster ("12th yoga
// class · 240 visits"). Every visit is one of: Group Fitness, Yoga, Cycle,
// Group Reformer, Pool, PT (appointments) or Check-in (front desk). Group
// Fitness isn't split into its classes (Sculpt, Svelte, The Yard...).
//
// Classes are sorted by name: Mindbody's own programs and categories mix
// these up (its general program holds yoga and cycle classes too). The SQL
// function private.class_category (migration 20261127120000) applies the
// same rules; keep the two in step.

export type VisitCategory = "group_fitness" | "yoga" | "cycle" | "reformer" | "pool" | "pt" | "check_in";

export const VISIT_CATEGORY_LABELS: Record<VisitCategory, string> = {
  group_fitness: "Group Fitness",
  yoga: "Yoga",
  cycle: "Cycle",
  reformer: "Group Reformer",
  pool: "Pool",
  pt: "PT",
  check_in: "Check-ins",
};

// What a class counts as, from its name.
export function classCategory(name: string | null | undefined): Exclude<VisitCategory, "pt" | "check_in"> {
  const n = (name ?? "").toLowerCase().trim();
  if (/pool lane|swim/.test(n)) return "pool";
  if (/reformer|pilates heat|small group pilates|intro to pilates|pilates 101/.test(n) || n === "pilates") return "reformer";
  if (/cycl|ride|r\.i\.d\.e|spin|rpm/.test(n)) return "cycle";
  if (/yoga|vinyasa|flow|hatha|yin|restorative|mat fusion|spinal strength|meditation/.test(n)) return "yoga";
  return "group_fitness";
}

// "12th yoga class": the noun for this class's category.
export function categoryNoun(category: VisitCategory): string {
  switch (category) {
    case "group_fitness":
      return "group fitness class";
    case "yoga":
      return "yoga class";
    case "cycle":
      return "cycle class";
    case "reformer":
      return "reformer class";
    case "pool":
      return "pool visit";
    case "pt":
      return "PT session";
    case "check_in":
      return "check-in";
  }
}

// "11 yoga classes", "1 pool visit".
export function categoryCount(n: number, category: VisitCategory): string {
  const noun = categoryNoun(category);
  const plural = n === 1 ? noun : noun.endsWith("class") ? `${noun}es` : `${noun}s`;
  return `${n.toLocaleString("en-US")} ${plural}`;
}
