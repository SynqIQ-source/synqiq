// class_name is free text sourced straight from MindBody's ClassDescription
// (see app/api/sync/classes/route.ts), so unlike departments there's no
// fixed list to hardcode -- this sandbox's data mixes real recurring class
// types with test/placeholder rows (confirmed empirically: "Test Class",
// "SBX-RFQ5F-Class", a bare "1", "Beach Conditioning bbbbb", etc.), so
// junk detection has to be rule-based. Used to keep those out of the
// Instructors page's class-name dropdown -- not applied to the page's
// existing blended "every class" fill rate, which is unaffected.

// Collapses the whitespace variants seen in the data (" Mat Fusion",
// "Reformer Pilates ", "RPM  ") so "Reformer Pilates" and "Reformer
// Pilates " group together instead of appearing as two separate options.
export function normalizeClassName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ");
}

// A MindBody-style auto-generated placeholder code, e.g. "SBX-RFQ5F-Class".
const PLACEHOLDER_CODE_PATTERN = /^[A-Z0-9]{2,6}-[A-Z0-9]{2,8}-class$/i;

// Keyboard-mash filler, e.g. "Beach Conditioning bbbbb" -- three or more of
// the same character in a row doesn't occur in a real class name.
const REPEATED_CHARACTER_PATTERN = /(.)\1{2,}/;

const EXCLUDED_CLASS_NAME_EXACT = new Set(
  [
    "Asp.net training",
    "PHP session",
    "Kristin's Really Cool Kickboxing Class",
    "Super awesome fun event!",
    "MyBeginner",
    "MFPC",
  ].map((name) => name.toLowerCase()),
);

export function isJunkClassName(name: string | null | undefined): boolean {
  const normalized = normalizeClassName(name);

  if (normalized.length <= 2) {
    return true;
  }
  if (/^test/i.test(normalized)) {
    return true;
  }
  if (PLACEHOLDER_CODE_PATTERN.test(normalized)) {
    return true;
  }
  if (REPEATED_CHARACTER_PATTERN.test(normalized)) {
    return true;
  }
  if (EXCLUDED_CLASS_NAME_EXACT.has(normalized.toLowerCase())) {
    return true;
  }

  return false;
}
