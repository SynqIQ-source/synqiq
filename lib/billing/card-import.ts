// Cards moving from Mindbody to Stripe (Jan 1 cutover). Mindbody's
// Subscriber Data Export sends the stored cards to Stripe (encrypted with
// Stripe's key); Stripe loads them into the studio's account and returns a
// file linking each old record to a new Stripe customer and card. That
// file's exact columns aren't known yet, so this reads any CSV whose headers
// match the names below and previews it (who it would give a card to);
// lib/billing/card-import-save.ts checks each card with Stripe and saves it.
// Pure.

export const IMPORT_COLUMNS = {
  clientId: ["mindbody_client_id", "client_id", "clientid", "client id", "member id", "member_id", "id"],
  customerId: ["stripe_customer_id", "customer_id", "customer", "customer id", "new_customer_id"],
  paymentMethodId: ["stripe_payment_method_id", "payment_method_id", "payment_method", "card_id", "source_id", "new_source_id", "pm"],
} as const;

export type ImportRow = { line: number; clientId: string; customerId: string; paymentMethodId: string };
export type ImportResult = { rows: ImportRow[]; problems: string[]; missingColumns: string[] };

// Minimal CSV: quoted fields, doubled quotes, commas and newlines in quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

export function readCardImport(text: string): ImportResult {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return { rows: [], problems: ["The file is empty."], missingColumns: [] };
  const names = header.map((name) => name.trim().toLowerCase());
  const find = (aliases: readonly string[]) => names.findIndex((name) => aliases.includes(name));
  const index = {
    clientId: find(IMPORT_COLUMNS.clientId),
    customerId: find(IMPORT_COLUMNS.customerId),
    paymentMethodId: find(IMPORT_COLUMNS.paymentMethodId),
  };
  const missingColumns = Object.entries(index)
    .filter(([, position]) => position < 0)
    .map(([key]) => key);
  if (missingColumns.length) return { rows: [], problems: [], missingColumns };
  const rows: ImportRow[] = [];
  const problems: string[] = [];
  body.forEach((cells, offset) => {
    const line = offset + 2;
    const clientId = (cells[index.clientId] ?? "").trim();
    const customerId = (cells[index.customerId] ?? "").trim();
    const paymentMethodId = (cells[index.paymentMethodId] ?? "").trim();
    if (!/^\d{1,20}$/.test(clientId)) return problems.push(`Line ${line}: client ID "${clientId}" isn't a Mindbody ID.`);
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) return problems.push(`Line ${line}: "${customerId}" isn't a Stripe customer.`);
    if (!/^(pm|card|src)_[A-Za-z0-9]+$/.test(paymentMethodId))
      return problems.push(`Line ${line}: "${paymentMethodId}" isn't a Stripe card.`);
    rows.push({ line, clientId, customerId, paymentMethodId });
  });
  return { rows, problems, missingColumns };
}
