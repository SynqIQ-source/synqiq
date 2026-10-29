// Name search helpers for staff pickers (merge target, referring member).
// Input is reduced to characters that can appear in a name so it can't break
// PostgREST's filter syntax, and LIKE wildcards are escaped.

export function searchTokens(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((token) => token.replace(/[\\%_]/g, (char) => `\\${char}`));
}

type Filterable<T> = {
  or(filters: string): T;
  ilike(column: string, pattern: string): T;
};

// "jan" -> first or last name starts with "jan"; "jane sm" -> first name
// starts with "jane" and last name starts with "sm".
export function applyNameSearch<T extends Filterable<T>>(query: T, tokens: string[]): T {
  if (tokens.length === 1) {
    return query.or(`first_name.ilike.${tokens[0]}*,last_name.ilike.${tokens[0]}*`);
  }
  return query.ilike("first_name", `${tokens[0]}%`).ilike("last_name", `${tokens.slice(1).join(" ")}%`);
}
