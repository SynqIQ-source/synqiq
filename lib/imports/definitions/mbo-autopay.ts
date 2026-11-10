import { createHash } from "crypto";
import type { ColumnDef, ImportContext, ImportDefinition, ResolveRowResult, TypedRowValues } from "@/lib/imports/types";

// Mindbody "AutoPay Detail" report (Club Admin upload on Settings -> Imports):
// one line per member, item and charge date, with its status. The answer
// key for shadow billing. Re-uploads update existing rows (statuses change).

export type AutopayRow = {
  charge_date: string;
  client_name: string;
  client_email: string | null;
  mindbody_client_id: string | null;
  match_method: "email" | "name" | null;
  location: string | null;
  item: string;
  contract_associated: boolean | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  amount_cents: number; // total including tax, as in the report
  status: "success" | "scheduled" | "suspended" | "declined" | "other";
  status_detail: string | null;
};

type AutopayContext = {
  byEmail: Map<string, string[]>;
  byName: Map<string, string[]>;
};

const COLUMNS: ColumnDef[] = [
  { field: "date", label: "Date", sourceHeaders: ["Date"], required: true, type: "date" },
  { field: "client", label: "Client", sourceHeaders: ["Client"], required: true, type: "string" },
  { field: "email", label: "Email", sourceHeaders: ["Email"], required: false, type: "string" },
  { field: "location", label: "Location", sourceHeaders: ["Location"], required: false, type: "string" },
  { field: "item", label: "Item", sourceHeaders: ["Item"], required: true, type: "string" },
  { field: "contract", label: "Contract Associated", sourceHeaders: ["Contract Associated"], required: false, type: "string" },
  { field: "billing", label: "Billing Information", sourceHeaders: ["Billing Information"], required: false, type: "string" },
  { field: "amount", label: "Amount", sourceHeaders: ["Amount"], required: true, type: "number" },
  { field: "status", label: "Status", sourceHeaders: ["Status"], required: true, type: "string" },
];

// Mindbody uses non-breaking spaces in names and phone numbers.
const clean = (value: string) => value.replace(/ /g, " ").replace(/\s+/g, " ").trim();

export const nameKey = (first: string, last: string) => `${clean(first)} ${clean(last)}`.toLowerCase();

// "Alvarado, Jason" -> { first: "Jason", last: "Alvarado" }
export function parseClientName(raw: string): { first: string; last: string; display: string } {
  const value = clean(raw);
  const comma = value.indexOf(",");
  if (comma === -1) return { first: value, last: "", display: value };
  const last = value.slice(0, comma).trim();
  const first = value.slice(comma + 1).trim();
  return { first, last, display: `${first} ${last}`.trim() };
}

// "Visa xxxx9423 Exp 03/30" -> brand Visa, last4 9423, 3/2030.
// "Master Card xxxxxxxx Exp 03/29" -> last4 unknown.
export function parseBilling(raw: string | null | undefined): {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
} {
  if (!raw) return { brand: null, last4: null, expMonth: null, expYear: null };
  const value = clean(raw);
  // Paid from the member's account balance, not a card.
  if (/^debit client account/i.test(value)) return { brand: "Account balance", last4: null, expMonth: null, expYear: null };
  const match = value.match(/^(.*?)\s+x+(\d{3,4})?\s*(?:Exp\s+(\d{1,2})\/(\d{2,4}))?/i);
  if (!match) return { brand: value || null, last4: null, expMonth: null, expYear: null };
  const year = match[4] ? Number(match[4]) : null;
  return {
    brand: match[1].trim() || null,
    last4: match[2] ?? null,
    expMonth: match[3] ? Number(match[3]) : null,
    expYear: year === null ? null : year < 100 ? 2000 + year : year,
  };
}

export function parseStatus(raw: string): { status: AutopayRow["status"]; detail: string | null } {
  const value = clean(raw);
  const lower = value.toLowerCase();
  if (lower === "success") return { status: "success", detail: null };
  if (lower === "scheduled") return { status: "scheduled", detail: null };
  if (lower.startsWith("suspended")) return { status: "suspended", detail: null };
  if (lower.startsWith("declined")) return { status: "declined", detail: value.replace(/^declined\s*-?\s*/i, "") || null };
  return { status: "other", detail: value };
}

// The report's last line is a summary ("Total transactions: ...").
function isIgnorableRow(raw: Record<string, string>): boolean {
  return Object.values(raw).some((cell) => /^Total transactions:/i.test(cell.trim()));
}

async function loadContext(ctx: ImportContext): Promise<AutopayContext> {
  const byEmail = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, id: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    map.set(key, list);
  };
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await ctx.supabase
      .from("clients")
      .select("mindbody_client_id, first_name, last_name, email")
      .eq("organization_id", ctx.organizationId)
      .not("mindbody_client_id", "is", null)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error(`Failed to load clients: ${error.message}`);
    for (const row of data ?? []) {
      const id = row.mindbody_client_id as string;
      add(byName, nameKey(row.first_name ?? "", row.last_name ?? ""), id);
      if (row.email) add(byEmail, (row.email as string).trim().toLowerCase(), id);
    }
    if (!data || data.length < 1000) break;
  }
  // Guests and members SynqIQ knows by email through the CRM.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await ctx.supabase
      .from("crm_contacts")
      .select("mindbody_client_id, email_normalized")
      .eq("organization_id", ctx.organizationId)
      .not("mindbody_client_id", "is", null)
      .not("email_normalized", "is", null)
      .order("id")
      .range(offset, offset + 999);
    if (error) break; // CRM not enabled or not readable: name matching still works
    for (const row of data ?? []) add(byEmail, row.email_normalized as string, row.mindbody_client_id as string);
    if (!data || data.length < 1000) break;
  }
  return { byEmail, byName };
}

function resolveRow(values: TypedRowValues, _ctx: ImportContext, extra: AutopayContext): ResolveRowResult<AutopayRow> {
  const name = parseClientName(values.client as string);
  const email = values.email ? clean(values.email as string).toLowerCase() : null;
  const byEmail = email ? (extra.byEmail.get(email) ?? []) : [];
  const byName = extra.byName.get(nameKey(name.first, name.last)) ?? [];
  let mindbodyClientId: string | null = null;
  let matchMethod: AutopayRow["match_method"] = null;
  if (byEmail.length === 1) {
    mindbodyClientId = byEmail[0];
    matchMethod = "email";
  } else if (byName.length === 1) {
    mindbodyClientId = byName[0];
    matchMethod = "name";
  } else if (byEmail.length > 1 && byName.length > 0) {
    const both = byEmail.filter((id) => byName.includes(id));
    if (both.length === 1) {
      mindbodyClientId = both[0];
      matchMethod = "email";
    }
  }

  const billing = parseBilling(values.billing as string | null);
  const status = parseStatus(values.status as string);
  const contract = values.contract ? clean(values.contract as string).toLowerCase() : null;

  return {
    row: {
      charge_date: values.date as string,
      client_name: name.display,
      client_email: email,
      mindbody_client_id: mindbodyClientId,
      match_method: matchMethod,
      location: values.location ? clean(values.location as string) : null,
      item: clean(values.item as string),
      contract_associated: contract === "yes" ? true : contract === "no" ? false : null,
      card_brand: billing.brand,
      card_last4: billing.last4,
      card_exp_month: billing.expMonth,
      card_exp_year: billing.expYear,
      amount_cents: Math.round((values.amount as number) * 100),
      status: status.status,
      status_detail: status.detail,
    },
  };
}

// The same scheduled charge keeps its key when its status changes, so a
// re-upload updates it instead of adding a second row.
function computeRowHash(row: AutopayRow, ctx: ImportContext): string {
  return createHash("sha256")
    .update(
      ["mbo_autopay", ctx.organizationId, row.charge_date, row.client_name.toLowerCase(), row.client_email ?? "", row.item.toLowerCase(), row.amount_cents].join("|"),
    )
    .digest("hex");
}

function computeWarnings(rows: AutopayRow[]) {
  const unmatched = rows.filter((row) => !row.mindbody_client_id);
  return {
    unmatchedRows: unmatched.length,
    unmatchedClients: new Set(unmatched.map((row) => row.client_name)).size,
    byStatus: rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export const MBO_AUTOPAY_DEFINITION: ImportDefinition<AutopayRow, AutopayContext> = {
  reportType: "mbo_autopay",
  table: "mbo_autopay_rows",
  columns: COLUMNS,
  loadContext,
  resolveRow,
  computeRowHash,
  computeWarnings,
  isIgnorableRow,
  updateOnConflict: true,
};
