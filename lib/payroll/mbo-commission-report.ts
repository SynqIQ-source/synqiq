// Parses Mindbody's Commission report (Reports > Commission, "All staff
// members - Detail") so the parallel run can credit sale lines to the people
// Mindbody actually paid. Accepts the report's Excel/HTML export, a CSV, or
// the table copied from the page (tab-separated).
//
// Layout: a row with just the staff member's name, a header row, then one
// row per sale line: Date, Item Name, client ID, "Commission" (or
// "Commission2" for the second rep on a split), Item Price, Client, [Logs],
// eight rate columns, Total.

export type ReportLine = {
  staffName: string;
  date: string; // YYYY-MM-DD
  item: string;
  clientId: string;
  split: boolean; // "Commission2": second rep on a split
  priceCents: number;
  totalCents: number;
};

function decode(text: string) {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#36;/g, "$")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

export function reportRows(input: string): string[][] {
  if (/<tr[\s>]/i.test(input)) {
    return [...input.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => decode(cell[1])),
    );
  }
  return input.split(/\r?\n/).map((line) => (line.includes("\t") ? line.split("\t") : csvCells(line)).map((cell) => cell.trim()));
}

export function moneyCents(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  const match = clean.match(/^\(?(-?\d+(?:\.\d+)?)\)?$/);
  if (!match) return null;
  const value = Math.round(Number(match[1]) * 100);
  return clean.startsWith("(") ? -Math.abs(value) : value;
}

export function parseCommissionReport(input: string): ReportLine[] {
  const lines: ReportLine[] = [];
  let staffName = "";
  for (const raw of reportRows(input)) {
    const cells = raw.map((cell) => cell.trim());
    const filled = cells.filter(Boolean);
    const date = cells[0]?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (date && /^Commission\d*$/i.test(cells[3] ?? "")) {
      const price = moneyCents(cells[4] ?? "");
      const total = moneyCents(filled[filled.length - 1] ?? "");
      if (price == null || total == null || !staffName) continue;
      lines.push({
        staffName,
        date: `${date[3]}-${date[1].padStart(2, "0")}-${date[2].padStart(2, "0")}`,
        item: cells[1],
        clientId: cells[2],
        split: /\d$/.test(cells[3]),
        priceCents: price,
        totalCents: total,
      });
      continue;
    }
    // A staff header: one filled cell that isn't a heading or a total.
    if (filled.length === 1 && !/^(date|total|grand total|reports|commission)\b/i.test(filled[0]) && /[a-z]/i.test(filled[0])) {
      staffName = filled[0];
    }
  }
  return lines;
}
