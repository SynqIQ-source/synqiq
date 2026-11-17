import { createHash } from "node:crypto";
import { DateTime } from "luxon";

// Gym Sales activity history (Reports -> Calls activity, SMS messages, Email
// messages; Excel exports). The reports carry only the person's name -- no
// Gym Sales id, phone or email -- so activity is matched to a lead by name,
// and only when exactly one lead has that name (never guessed). Times are in
// the studio's timezone (the reports show the viewer's local time).

export type GymSalesActivity = {
  kind: "call" | "sms" | "email";
  direction: "outbound" | "inbound";
  personName: string;
  at: string; // ISO UTC
  outcome: string | null; // calls: Left Message / Spoke to / No answer
  body: string | null;
  subject: string | null;
  sentBy: string | null;
  nextAction: string | null;
  sourceKey: string; // stable hash, so re-running never duplicates
};

type Row = Record<string, unknown>;
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

function hash(parts: string[]) {
  return createHash("sha256").update(parts.join("␟")).digest("hex").slice(0, 32);
}

function parseLocal(value: string, zone: string): DateTime | null {
  for (const format of ["MM/dd/yyyy hh:mm a", "M/d/yyyy h:mm a", "MM/dd/yyyy h:mm a"]) {
    const parsed = DateTime.fromFormat(value.toLowerCase(), format, { zone, locale: "en-US" });
    if (parsed.isValid) return parsed;
  }
  return null;
}

// Calls report: day-header rows ("Monday 16 November 2026" in the name
// column, nothing else) followed by that day's calls with a time.
export function parseCalls(rows: Row[], zone: string): GymSalesActivity[] {
  const out: GymSalesActivity[] = [];
  let day: DateTime | null = null;
  rows.forEach((row) => {
    const name = text(row["Person Name"]);
    const time = text(row["Time"]);
    if (!time) {
      const header = DateTime.fromFormat(name, "cccc d LLLL yyyy", { zone, locale: "en-US" });
      if (header.isValid) day = header;
      return;
    }
    if (!day || !name) return;
    const clock = DateTime.fromFormat(time.toLowerCase(), "hh:mm a", { zone, locale: "en-US" });
    if (!clock.isValid) return;
    const at = day.set({ hour: clock.hour, minute: clock.minute });
    const body = text(row["Call Description"]) || null;
    const outcome = text(row["Call Outcome"]) || null;
    out.push({
      kind: "call",
      direction: "outbound",
      personName: name,
      at: at.toUTC().toISO()!,
      outcome,
      body,
      subject: null,
      sentBy: null,
      nextAction: text(row["Next Action"]) || null,
      sourceKey: hash(["call", name, at.toISO()!, outcome ?? "", body ?? ""]),
    });
  });
  return out;
}

export function parseMessages(rows: Row[], kind: "sms" | "email", zone: string): GymSalesActivity[] {
  const out: GymSalesActivity[] = [];
  rows.forEach((row) => {
    const name = text(row["Person Name"]);
    const when = parseLocal(text(row["Date & Time"]), zone);
    if (!name || !when) return;
    const direction = kind === "sms" && /^inbound$/i.test(text(row["Direction"])) ? "inbound" : "outbound";
    const body = text(row["Message"]) || null;
    const subject = kind === "email" ? text(row["Subject"]) || null : null;
    out.push({
      kind,
      direction,
      personName: name,
      at: when.toUTC().toISO()!,
      outcome: null,
      body,
      subject,
      sentBy: direction === "outbound" ? text(row["Send By"]) || null : null,
      nextAction: null,
      sourceKey: hash([kind, direction, name, when.toISO()!, body ?? ""]),
    });
  });
  return out;
}

// "Conor P. McEvily" -> "conor p mcevily"; accents and punctuation dropped.
export function nameKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// First and last word only ("conor p mcevily" -> "conor mcevily").
export function shortNameKey(value: string): string {
  const words = nameKey(value).split(" ").filter(Boolean);
  return words.length >= 2 ? `${words[0]} ${words[words.length - 1]}` : words.join(" ");
}

export type MatchableContact = { id: string; first_name: string | null; last_name: string | null };

// Name -> the one contact with that name. Full name first, then first + last
// word; a name shared by two or more leads matches nobody.
export function buildNameIndex(contacts: MatchableContact[]) {
  const full = new Map<string, string[]>();
  const short = new Map<string, string[]>();
  for (const contact of contacts) {
    const name = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`;
    const fullKey = nameKey(name);
    if (!fullKey.includes(" ")) continue;
    full.set(fullKey, [...(full.get(fullKey) ?? []), contact.id]);
    const shortKey = shortNameKey(name);
    short.set(shortKey, [...(short.get(shortKey) ?? []), contact.id]);
  }
  return (personName: string): { id: string } | { ambiguous: true } | null => {
    for (const [index, key] of [
      [full, nameKey(personName)],
      [short, shortNameKey(personName)],
    ] as const) {
      const ids = [...new Set(index.get(key) ?? [])];
      if (ids.length === 1) return { id: ids[0] };
      if (ids.length > 1) return { ambiguous: true };
    }
    return null;
  };
}
