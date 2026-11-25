import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  activateCutover,
  cutoverCardLinkPreview,
  payersWithCards,
  sendCutoverCardLinks,
  setCutoverLock,
  setCutoverRowIncluded,
  takeCutoverSnapshot,
} from "@/lib/billing/cutover-job";
import { readCardImport } from "@/lib/billing/card-import";
import { saveImportedCards } from "@/lib/billing/card-import-save";

export const maxDuration = 300;

// Club Admins: the Jan 1 cutover snapshot (take/refresh, lock, include or
// leave out a contract, create schedules for payers with cards) and a CSV of it.
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return fail("Club Admins only.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const org = staff.organizationId;
  const respond = (result: Record<string, unknown>) =>
    "error" in result ? fail(String(result.error)) : NextResponse.json({ success: true, ...result });

  switch (body?.action) {
    case "snapshot":
      return respond(await takeCutoverSnapshot(org, staff.id));
    case "lock":
      return respond(await setCutoverLock(org, staff.id, true));
    case "unlock":
      return respond(await setCutoverLock(org, staff.id, false));
    case "include":
    case "exclude": {
      const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
      if (!id) return fail("Not found.");
      return respond(await setCutoverRowIncluded(org, id, body.action === "include"));
    }
    case "activate":
      return respond(await activateCutover(org));
    case "card_links_preview":
      return respond(await cutoverCardLinkPreview(org));
    case "card_links_send": {
      const count = Number(body.count);
      if (!Number.isInteger(count) || count < 1) return fail("Nothing to send.");
      return respond(await sendCutoverCardLinks(org, staff.id, count));
    }
    case "import_preview": {
      // Preview only: who the card file would give a card to. Nothing is saved.
      const csv = typeof body.csv === "string" ? body.csv.slice(0, 5_000_000) : "";
      const result = readCardImport(csv);
      if (result.missingColumns.length) return respond({ missingColumns: result.missingColumns, rows: 0, matched: 0, problems: [] });
      const admin = createSupabaseAdminClient();
      const payers = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data } = await admin
          .from("billing_cutover_rows")
          .select("payer_mindbody_client_id")
          .eq("organization_id", org)
          .eq("status", "planned")
          .range(from, from + 999);
        for (const row of data ?? []) payers.add(row.payer_mindbody_client_id as string);
        if (!data || data.length < 1000) break;
      }
      const matched = new Set(result.rows.filter((row) => payers.has(row.clientId)).map((row) => row.clientId));
      return respond({
        missingColumns: [],
        rows: result.rows.length,
        matched: matched.size,
        payersWithoutCard: [...payers].filter((payer) => !matched.has(payer)).length,
        problems: result.problems.slice(0, 20),
      });
    }
    case "import_check":
    case "import_save": {
      // Every card is checked with Stripe; "check" saves nothing.
      const csv = typeof body.csv === "string" ? body.csv.slice(0, 5_000_000) : "";
      const result = readCardImport(csv);
      if (result.missingColumns.length) return fail(`The file is missing columns: ${result.missingColumns.join(", ")}.`);
      if (!result.rows.length) return fail("No cards in the file.");
      return respond(await saveImportedCards(org, staff.id, result.rows, { dryRun: body.action === "import_check" }));
    }
    default:
      return fail("Unknown action.");
  }
}

const csvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return fail("Club Admins only.", 403);
  const admin = createSupabaseAdminClient();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("billing_cutover_rows")
      .select(
        "payer_name, payer_mindbody_client_id, member_name, member_mindbody_client_id, contract_name, mindbody_client_contract_id, bill_day, first_bill_date, subtotal_cents, tax_cents, total_cents, remaining_payments, auto_renews, status, excluded_reason",
      )
      .eq("organization_id", staff.organizationId)
      .order("payer_name")
      .range(from, from + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const cards = await payersWithCards(admin, staff.organizationId);
  const header = [
    "Payer",
    "Payer ID",
    "Member",
    "Member ID",
    "Contract",
    "Mindbody contract",
    "Bill day",
    "First SynqIQ bill",
    "Subtotal",
    "Tax",
    "Total",
    "Payments left",
    "Renews",
    "Card in Stripe",
    "Status",
    "Why left out",
  ];
  const money = (cents: unknown) => (cents == null ? "" : (Number(cents) / 100).toFixed(2));
  const lines = rows.map((row) =>
    [
      row.payer_name,
      row.payer_mindbody_client_id,
      row.member_name,
      row.member_mindbody_client_id,
      row.contract_name,
      row.mindbody_client_contract_id,
      row.bill_day,
      row.first_bill_date,
      money(row.subtotal_cents),
      money(row.tax_cents),
      money(row.total_cents),
      row.remaining_payments ?? (row.auto_renews ? "until cancelled" : ""),
      row.auto_renews ? "yes" : "no",
      cards.has(row.payer_mindbody_client_id as string) ? "yes" : "no",
      row.status,
      row.excluded_reason,
    ]
      .map(csvCell)
      .join(","),
  );
  return new NextResponse([header.join(","), ...lines].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="synqiq-jan1-cutover.csv"' },
  });
}
