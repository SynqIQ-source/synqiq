// Agreement templates are plain text with {{placeholders}} that are filled in
// with what is actually being sold, so the agreement always names the item
// and prices on the receipt. Pure: shared by checkout, the server and tests.

export const PLACEHOLDERS = {
  business_name: "The studio's legal name (e.g. The Preserve Gym LLC)",
  member_name: "The buyer's name",
  item: "What's being bought (membership or package name)",
  monthly_dues: "Monthly dues before tax (memberships), e.g. $269.00",
  first_payment: "Amount paid today for this item, before tax",
  sessions: "Sessions in the package",
  date: "Today's date",
} as const;
export type PlaceholderKey = keyof typeof PLACEHOLDERS;
export type AgreementValues = Partial<Record<PlaceholderKey, string>>;

export function fillAgreement(body: string, values: AgreementValues): string {
  return body
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => (key in PLACEHOLDERS ? (values[key as PlaceholderKey] ?? "—") : match))
    .replace(/\r\n/g, "\n")
    .trim();
}

export const agreementTitle = (item: string) => `${item} Agreement`;

export const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The yearly rate-increase clause added to every membership agreement.
export const RATE_INCREASE_CLAUSE =
  "Annual Rate Increase: After the first year of membership, {{business_name}} may increase the monthly membership rate by one percent (1%) to five percent (5%) per year. {{business_name}} will notify the member by email at least thirty (30) days before any increase takes effect.";

// Turns an agreement imported from Mindbody into a SynqIQ template: the
// "Membership Type / Monthly Dues / First Payment Due" lines Mindbody filled
// with its own plan's name and prices become placeholders, and (for
// memberships) the rate-increase clause goes right after the sales-tax
// paragraph (or after the header when there isn't one).
export function templateFromMindbody(text: string, options: { rateIncrease: boolean }): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let clauseAdded = !options.rateIncrease;
  let headerEnd = -1;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*Membership Type\s*:/i.test(line)) {
      out.push("Membership Type: {{item}}");
      headerEnd = out.length;
      continue;
    }
    if (/^\s*Monthly Dues\s*:/i.test(line)) {
      out.push("Monthly Dues: {{monthly_dues}}, plus tax");
      headerEnd = out.length;
      continue;
    }
    if (/^\s*First Payment Due\s*:/i.test(line)) {
      out.push("First Payment Due: {{first_payment}}, plus tax");
      headerEnd = out.length;
      continue;
    }
    if (/^\s*Ongoing Due Date\s*:/i.test(line)) headerEnd = out.length + 1;
    out.push(line);
    if (!clauseAdded && /sales tax rates?/i.test(line) && /increase/i.test(line)) {
      out.push("", RATE_INCREASE_CLAUSE);
      clauseAdded = true;
    }
  }
  if (!clauseAdded) out.splice(headerEnd >= 0 ? headerEnd : 0, 0, "", RATE_INCREASE_CLAUSE, "");
  return out.join("\n").trim();
}

// The header put on personal-training agreements (Mindbody's PT policy has none).
export const PACKAGE_HEADER = "Package: {{item}}\nSessions: {{sessions}}\nPrice: {{first_payment}}, plus tax\n\n";
