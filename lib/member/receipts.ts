import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildReceiptPdf, type ReceiptInput } from "@/lib/pos/receipt-pdf";

// A member's receipts in the member portal: checkout sales rung up to them
// (in club, and in the app once it sells) and their monthly dues payments.
// Every lookup is scoped to the studio AND the signed-in member's client id,
// so nobody can open someone else's receipt by guessing an id.
//
// Before payments go live, SynqIQ's sales and dues are practice only; those
// are listed and printed with a clear "practice -- no payment taken" mark
// Real dues receipts
// come from the payment records once Stripe is live.

export type ReceiptKind = "sale" | "dues";
export type ReceiptRow = { kind: ReceiptKind; id: string; date: string; description: string; totalCents: number; practice: boolean };

const PAYMENT_LABELS: Record<string, string> = {
  practice: "Practice -- no payment taken",
  card: "Card",
  card_test: "Card (Stripe test)",
  card_present: "Card",
  card_on_file: "Card on file",
  cash: "Cash",
  account: "Account balance",
};

type Who = { organizationId: string; mindbodyClientId: string; timezone: string };

export async function listReceipts(who: Who): Promise<ReceiptRow[]> {
  const admin = createSupabaseAdminClient();
  const today = DateTime.now().setZone(who.timezone).toISODate()!;
  const [{ data: sales }, { data: dues }] = await Promise.all([
    admin
      .from("pos_sales")
      .select("id, sale_number, status, total_cents, created_at, lines:pos_sale_lines ( name )")
      .eq("organization_id", who.organizationId)
      .eq("mindbody_client_id", who.mindbodyClientId)
      .in("status", ["completed", "practice"])
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("practice_charges")
      .select("id, due_date, total_cents, schedule:member_billing_schedules!inner ( name, status, voided_at )")
      .eq("organization_id", who.organizationId)
      .eq("mindbody_client_id", who.mindbodyClientId)
      .lte("due_date", today)
      .order("due_date", { ascending: false })
      .limit(200),
  ]);
  const rows: ReceiptRow[] = [];
  for (const sale of sales ?? []) {
    const names = ((sale.lines as { name: string }[] | null) ?? []).map((line) => line.name);
    rows.push({
      kind: "sale",
      id: sale.id as string,
      date: DateTime.fromISO(sale.created_at as string)
        .setZone(who.timezone)
        .toISODate()!,
      description: names.length > 2 ? `${names.slice(0, 2).join(", ")} + ${names.length - 2} more` : names.join(", ") || "Purchase",
      totalCents: Number(sale.total_cents),
      practice: sale.status === "practice",
    });
  }
  for (const charge of dues ?? []) {
    const schedule = (Array.isArray(charge.schedule) ? charge.schedule[0] : charge.schedule) as {
      name: string;
      voided_at: string | null;
    } | null;
    if (!schedule || schedule.voided_at) continue;
    rows.push({
      kind: "dues",
      id: charge.id as string,
      date: charge.due_date as string,
      description: `Monthly dues · ${schedule.name}`,
      totalCents: Number(charge.total_cents),
      practice: true,
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

// The receipt PDF, or null when it isn't this member's.
export async function memberReceiptPdf(who: Who & { studioName: string; memberName: string }, kind: ReceiptKind, id: string) {
  const admin = createSupabaseAdminClient();
  let input: ReceiptInput | null = null;
  if (kind === "sale") {
    const { data: sale } = await admin
      .from("pos_sales")
      .select(
        "id, sale_number, status, client_name, subtotal_cents, discount_cents, tax_cents, total_cents, payment_method, created_at, lines:pos_sale_lines ( name, quantity, unit_price_cents, line_number )",
      )
      .eq("id", id)
      .eq("organization_id", who.organizationId)
      .eq("mindbody_client_id", who.mindbodyClientId)
      .in("status", ["completed", "practice"])
      .is("voided_at", null)
      .maybeSingle();
    if (!sale) return null;
    const lines = ((sale.lines as { name: string; quantity: number; unit_price_cents: number; line_number: number }[] | null) ?? []).sort(
      (a, b) => a.line_number - b.line_number,
    );
    input = {
      studioName: who.studioName,
      title: "Receipt",
      number: `Sale #${sale.sale_number}`,
      dateLocal: DateTime.fromISO(sale.created_at as string)
        .setZone(who.timezone)
        .toFormat("LLL d, yyyy, h:mm a"),
      memberName: (sale.client_name as string | null) ?? who.memberName,
      lines: lines.map((line) => ({ name: line.name, quantity: line.quantity, amountCents: line.unit_price_cents * line.quantity })),
      subtotalCents: Number(sale.subtotal_cents),
      discountCents: Number(sale.discount_cents),
      taxCents: Number(sale.tax_cents),
      totalCents: Number(sale.total_cents),
      paymentLabel: PAYMENT_LABELS[sale.payment_method as string] ?? (sale.payment_method as string),
      practice: sale.status === "practice",
    };
  } else {
    const today = DateTime.now().setZone(who.timezone).toISODate()!;
    const { data: charge } = await admin
      .from("practice_charges")
      .select(
        "id, due_date, subtotal_cents, tax_cents, total_cents, schedule:member_billing_schedules!inner ( name, client_name, voided_at )",
      )
      .eq("id", id)
      .eq("organization_id", who.organizationId)
      .eq("mindbody_client_id", who.mindbodyClientId)
      .lte("due_date", today)
      .maybeSingle();
    const schedule = charge
      ? ((Array.isArray(charge.schedule) ? charge.schedule[0] : charge.schedule) as {
          name: string;
          client_name: string | null;
          voided_at: string | null;
        })
      : null;
    if (!charge || !schedule || schedule.voided_at) return null;
    input = {
      studioName: who.studioName,
      title: "Monthly dues receipt",
      number: `Dues for ${DateTime.fromISO(charge.due_date as string).toFormat("LLLL yyyy")}`,
      dateLocal: DateTime.fromISO(charge.due_date as string).toFormat("LLL d, yyyy"),
      memberName: schedule.client_name ?? who.memberName,
      lines: [{ name: `Monthly dues - ${schedule.name}`, quantity: 1, amountCents: Number(charge.subtotal_cents) }],
      subtotalCents: Number(charge.subtotal_cents),
      discountCents: 0,
      taxCents: Number(charge.tax_cents),
      totalCents: Number(charge.total_cents),
      paymentLabel: PAYMENT_LABELS.practice,
      practice: true,
    };
  }
  return { pdf: await buildReceiptPdf(input), filename: `${input.number.replace(/[^A-Za-z0-9]+/g, "-")}.pdf` };
}
