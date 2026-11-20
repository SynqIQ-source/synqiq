import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripeLivemode } from "@/lib/payments/connect";
import { DEFAULT_CUTOVER_DATE, planCutover } from "@/lib/billing/cutover";
import { loadEmailKit, studioFrom } from "@/lib/email/studio-kit";
import { emailButton, renderStudioEmail } from "@/lib/email/studio-templates";
import { createCardLink } from "@/lib/billing/card-links";
import { memberEmail } from "@/lib/billing/notify";
import { sendEmailMessages } from "@/lib/email/send";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// The cutover snapshot (lib/billing/cutover.ts for the rules). Reads
// Mindbody's synced contracts only; never writes to Mindbody, never charges.

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function cutoverSettings(admin: Admin, organizationId: string) {
  const { data } = await admin
    .from("billing_cutover_settings")
    .select("cutover_date, snapshot_at, locked_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return {
    cutoverDate: ((data?.cutover_date as string | null) ?? DEFAULT_CUTOVER_DATE).slice(0, 10),
    snapshotAt: (data?.snapshot_at as string | null) ?? null,
    lockedAt: (data?.locked_at as string | null) ?? null,
  };
}

// Takes (or refreshes, until locked) the snapshot from Mindbody's synced
// autopay contracts. Staff choices (excluded / included) and activated rows
// are kept. Before the lock, a contract no longer active in Mindbody is
// marked excluded; after the lock nothing changes.
export async function takeCutoverSnapshot(organizationId: string, staffId: string) {
  const admin = createSupabaseAdminClient();
  const settings = await cutoverSettings(admin, organizationId);
  if (settings.lockedAt) return { error: "The snapshot is locked. Unlock it first (only possible before any schedules are created)." };
  const [{ data: org }, contracts, clients, existing] = await Promise.all([
    admin.from("organizations").select("sales_tax_rate, timezone").eq("id", organizationId).maybeSingle(),
    all((a, b) =>
      admin
        .from("member_contracts")
        .select(
          "mindbody_client_contract_id, mindbody_client_id, payer_mindbody_client_id, contract_name, autopay_status, start_date, next_bill_date, end_date, termination_date, auto_renewing, normal_autopay_cents, next_bill_subtotal_cents, next_bill_tax_cents, upcoming_autopays",
        )
        .eq("organization_id", organizationId)
        .in("autopay_status", ["Active", "Suspended"])
        .order("mindbody_client_contract_id")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("clients")
        .select("mindbody_client_id, first_name, last_name")
        .eq("organization_id", organizationId)
        .not("mindbody_client_id", "is", null)
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      admin
        .from("billing_cutover_rows")
        .select("id, mindbody_client_contract_id, status, excluded_by_staff")
        .eq("organization_id", organizationId)
        .order("id")
        .range(a, b),
    ),
  ]);
  const taxRate = Number(org?.sales_tax_rate ?? 0.0825);
  const today = new Date().toISOString().slice(0, 10);
  const nameOf = new Map(clients.map((row) => [row.mindbody_client_id as string, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
  const existingBy = new Map(existing.map((row) => [String(row.mindbody_client_contract_id), row]));
  const seen = new Set<string>();
  const upserts: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  for (const contract of contracts) {
    const terminated = contract.termination_date && (contract.termination_date as string).slice(0, 10) <= today;
    if (terminated) continue;
    const key = String(contract.mindbody_client_contract_id);
    seen.add(key);
    const prior = existingBy.get(key);
    if (prior?.status === "activated") continue;
    const plan = planCutover(
      {
        nextBillDate: (contract.next_bill_date as string | null)?.slice(0, 10) ?? null,
        startDate: (contract.start_date as string | null)?.slice(0, 10) ?? null,
        endDate: (contract.end_date as string | null)?.slice(0, 10) ?? null,
        autoRenewing: Boolean(contract.auto_renewing),
        normalCents: Number(contract.normal_autopay_cents ?? 0),
        nextSubtotalCents: contract.next_bill_subtotal_cents == null ? null : Number(contract.next_bill_subtotal_cents),
        nextTaxCents: contract.next_bill_tax_cents == null ? null : Number(contract.next_bill_tax_cents),
        upcoming: Array.isArray(contract.upcoming_autopays) ? (contract.upcoming_autopays as { date: string }[]) : null,
      },
      settings.cutoverDate,
      taxRate,
    );
    const member = contract.mindbody_client_id as string;
    const payer = (contract.payer_mindbody_client_id as string | null) || member;
    const suspended = contract.autopay_status === "Suspended";
    const planned = !("exclude" in plan);
    // Staff's own include/exclude choice stays.
    const status = prior?.excluded_by_staff ? prior.status : planned && !suspended ? "planned" : "excluded";
    upserts.push({
      organization_id: organizationId,
      mindbody_client_contract_id: Number(contract.mindbody_client_contract_id),
      member_mindbody_client_id: member,
      payer_mindbody_client_id: payer,
      member_name: nameOf.get(member) ?? null,
      payer_name: nameOf.get(payer) ?? null,
      contract_name: (contract.contract_name as string | null) ?? "Membership",
      autopay_status: contract.autopay_status,
      first_bill_date: planned ? plan.firstBillDate : null,
      bill_day: planned ? plan.billDay : null,
      subtotal_cents: planned ? plan.subtotalCents : null,
      tax_cents: planned ? plan.taxCents : null,
      total_cents: planned ? plan.totalCents : null,
      remaining_payments: planned ? plan.remainingPayments : null,
      auto_renews: planned ? plan.autoRenews : Boolean(contract.auto_renewing),
      basis: planned ? plan.basis : null,
      contract_end_date: (contract.end_date as string | null)?.slice(0, 10) ?? null,
      status,
      excluded_reason:
        status === "excluded"
          ? prior?.excluded_by_staff
            ? "Left out by staff"
            : !planned
              ? plan.exclude
              : "Autopay suspended in Mindbody"
          : null,
      excluded_by_staff: prior?.excluded_by_staff ?? false,
      captured_at: now,
    });
  }
  // An assumed renewal isn't needed when the member already has another
  // contract in the plan (Mindbody generated the next term as its own contract).
  const plannedMembers = new Set(
    upserts
      .filter((row) => row.status === "planned" && row.basis !== "assumed_renewal")
      .map((row) => row.member_mindbody_client_id as string),
  );
  for (const row of upserts) {
    if (
      row.basis === "assumed_renewal" &&
      row.status === "planned" &&
      !row.excluded_by_staff &&
      plannedMembers.has(row.member_mindbody_client_id as string)
    ) {
      row.status = "excluded";
      row.excluded_reason = "Renewed contract already in the plan";
    }
  }
  for (let i = 0; i < upserts.length; i += 500) {
    const { error } = await admin
      .from("billing_cutover_rows")
      .upsert(upserts.slice(i, i + 500), { onConflict: "organization_id,mindbody_client_contract_id" });
    if (error) return { error: error.message };
  }
  // No longer active in Mindbody (cancelled since the last snapshot).
  const gone = existing
    .filter((row) => row.status === "planned" && !seen.has(String(row.mindbody_client_contract_id)))
    .map((row) => row.id);
  for (let i = 0; i < gone.length; i += 500)
    await admin
      .from("billing_cutover_rows")
      .update({ status: "excluded", excluded_reason: "No longer active in Mindbody" })
      .in("id", gone.slice(i, i + 500));
  await admin
    .from("billing_cutover_settings")
    .upsert({ organization_id: organizationId, snapshot_at: now, snapshot_by_staff_id: staffId, updated_at: now });
  return { contracts: upserts.length, noLongerActive: gone.length };
}

export async function setCutoverLock(organizationId: string, staffId: string, locked: boolean) {
  const admin = createSupabaseAdminClient();
  const settings = await cutoverSettings(admin, organizationId);
  if (locked && !settings.snapshotAt) return { error: "Take the snapshot first." };
  if (!locked) {
    const { count } = await admin
      .from("billing_cutover_rows")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "activated");
    if (count) return { error: "Schedules have been created from this snapshot, so it stays locked." };
  }
  const now = new Date().toISOString();
  const { error } = await admin.from("billing_cutover_settings").upsert({
    organization_id: organizationId,
    locked_at: locked ? now : null,
    locked_by_staff_id: locked ? staffId : null,
    updated_at: now,
  });
  return error ? { error: error.message } : { success: true };
}

export async function setCutoverRowIncluded(organizationId: string, rowId: string, include: boolean) {
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("billing_cutover_rows")
    .select("status, first_bill_date")
    .eq("id", rowId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!row) return { error: "Not found." };
  if (row.status === "activated") return { error: "Its schedule is already created. Cancel it from the member's profile instead." };
  if (include && !row.first_bill_date) return { error: "There's no payment after the cutover to bill." };
  const { error } = await admin
    .from("billing_cutover_rows")
    .update(
      include
        ? { status: "planned", excluded_reason: null, excluded_by_staff: true }
        : { status: "excluded", excluded_reason: "Left out by staff", excluded_by_staff: true },
    )
    .eq("id", rowId);
  return error ? { error: error.message } : { success: true };
}

// Payers with a monthly-dues card in Stripe (for the current key mode).
export async function payersWithCards(admin: Admin, organizationId: string) {
  const cards = await all((a, b) =>
    admin
      .from("member_cards")
      .select(
        "mindbody_client_id, stripe_account_id, stripe_customer_id, stripe_payment_method_id, card_brand, card_last4, card_exp_month, card_exp_year",
      )
      .eq("organization_id", organizationId)
      .eq("purpose", "dues")
      .eq("livemode", stripeLivemode())
      .order("mindbody_client_id")
      .range(a, b),
  );
  return new Map(cards.map((card) => [card.mindbody_client_id as string, card]));
}

// Creates the SynqIQ billing schedules for every planned contract whose payer
// has a card on file (repeatable: run again as more cards come in). Only
// from a locked snapshot. The first charge is each member's first bill on or
// after the cutover date; live charging still needs SYNQIQ_RENEWALS_LIVE.
export async function activateCutover(organizationId: string) {
  const admin = createSupabaseAdminClient();
  const settings = await cutoverSettings(admin, organizationId);
  if (!settings.lockedAt) return { error: "Lock the snapshot first." };
  const [rows, cards] = await Promise.all([
    all((a, b) =>
      admin.from("billing_cutover_rows").select("*").eq("organization_id", organizationId).eq("status", "planned").order("id").range(a, b),
    ),
    payersWithCards(admin, organizationId),
  ]);
  const live = stripeLivemode();
  let created = 0;
  let waiting = 0;
  for (const row of rows) {
    const card = cards.get(row.payer_mindbody_client_id as string);
    if (!card || !row.first_bill_date) {
      waiting += 1;
      continue;
    }
    const memberNote = row.member_mindbody_client_id !== row.payer_mindbody_client_id && row.member_name ? ` (for ${row.member_name})` : "";
    const { data: schedule, error } = await admin
      .from("member_billing_schedules")
      .insert({
        organization_id: organizationId,
        source: "mindbody",
        mindbody_client_contract_id: row.mindbody_client_contract_id,
        mindbody_client_id: row.payer_mindbody_client_id,
        client_name: row.payer_name,
        name: `${row.contract_name}${memberNote}`,
        status: live ? "active" : "practice",
        start_date: row.first_bill_date,
        end_date: row.auto_renews ? null : row.contract_end_date,
        first_bill_date: row.first_bill_date,
        recurring_lines: [{ label: "Monthly dues", amountCents: row.subtotal_cents, taxable: Number(row.tax_cents) > 0 }],
        recurring_subtotal_cents: row.subtotal_cents,
        recurring_tax_cents: row.tax_cents,
        recurring_total_cents: row.total_cents,
        autopay_count: row.remaining_payments,
        auto_renews: Boolean(row.auto_renews),
        stripe_account_id: card.stripe_account_id,
        stripe_customer_id: card.stripe_customer_id,
        stripe_payment_method_id: card.stripe_payment_method_id,
        card_brand: card.card_brand,
        card_last4: card.card_last4,
        card_exp_month: card.card_exp_month,
        card_exp_year: card.card_exp_year,
      })
      .select("id")
      .single();
    if (error || !schedule) continue;
    const { data: claimed } = await admin
      .from("billing_cutover_rows")
      .update({ status: "activated", schedule_id: schedule.id, activated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "planned")
      .select("id");
    if (!claimed?.length) await admin.from("member_billing_schedules").delete().eq("id", schedule.id);
    else created += 1;
  }
  return { created, waiting };
}

// Payers in the plan who still need a dues card (not emailed in the last 7 days).
async function payersNeedingCard(admin: Admin, organizationId: string) {
  const [rows, cards] = await Promise.all([
    all((a, b) =>
      admin
        .from("billing_cutover_rows")
        .select("payer_mindbody_client_id, contract_name, card_link_sent_at")
        .eq("organization_id", organizationId)
        .eq("status", "planned")
        .order("id")
        .range(a, b),
    ),
    payersWithCards(admin, organizationId),
  ]);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const payers = new Map<string, { membership: string; recentlySent: boolean }>();
  for (const row of rows) {
    const payer = row.payer_mindbody_client_id as string;
    if (cards.has(payer)) continue;
    const recent = Boolean(row.card_link_sent_at) && Date.parse(row.card_link_sent_at as string) > weekAgo;
    const prior = payers.get(payer);
    payers.set(payer, {
      membership: prior?.membership ?? (row.contract_name as string),
      recentlySent: (prior?.recentlySent ?? false) || recent,
    });
  }
  return payers;
}

export async function cutoverCardLinkPreview(organizationId: string) {
  const payers = await payersNeedingCard(createSupabaseAdminClient(), organizationId);
  const due = [...payers.values()].filter((payer) => !payer.recentlySent).length;
  return { due, recentlySent: payers.size - due };
}

// Emails every payer who still needs a card a one-time "add your card" link
// (Email > Templates > "Add your card"). Only when a Club Admin confirms the
// exact count shown; at most once a week per payer.
export async function sendCutoverCardLinks(organizationId: string, staffId: string, confirmCount: number) {
  const admin = createSupabaseAdminClient();
  const payers = await payersNeedingCard(admin, organizationId);
  const due = [...payers.entries()].filter(([, payer]) => !payer.recentlySent);
  if (due.length !== confirmCount) return { error: `The number changed (now ${due.length}). Check it and confirm again.` };
  const [kit, settings] = await Promise.all([loadEmailKit(admin, organizationId), cutoverSettings(admin, organizationId)]);
  const startDate = new Date(`${settings.cutoverDate}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  let sent = 0;
  let noEmail = 0;
  for (const [payer, info] of due) {
    const contact = await memberEmail(admin, organizationId, payer);
    if (!contact.email) {
      noEmail += 1;
      continue;
    }
    const url = await createCardLink(admin, organizationId, payer, "staff", staffId);
    const email = renderStudioEmail(
      "card_cutover",
      { first_name: contact.firstName, membership: info.membership, start_date: startDate },
      kit,
      {
        action: emailButton(url, "Add my card", kit.branding.color, "This secure link works for 7 days."),
      },
    );
    const result = await sendEmailMessages([{ to: contact.email, from: studioFrom(kit.branding.studioName, kit.fromDomain), ...email }]);
    if (!result.sent.length) continue;
    sent += 1;
    await admin
      .from("billing_cutover_rows")
      .update({ card_link_sent_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("payer_mindbody_client_id", payer);
  }
  return { sent, noEmail };
}
