import type { MindbodyClientContract, MindbodyContractTemplate } from "@/types/mindbody";

// Pure conversion of Mindbody contract data into SynqIQ rows (no I/O), so it
// can be unit-tested. Used by lib/sync/member-contracts.ts.

export const toCents = (amount: number | null | undefined): number | null =>
  typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount * 100) : null;

// "2026-03-16T00:00:00" -> "2026-03-16" (Mindbody dates are studio-local).
export const toDate = (value: string | null | undefined): string | null =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

// Walks each contract back through AutoRenewClientContractID (the contract
// it renewed from) to the first contract in its chain. When an earlier link
// isn't among the contracts Mindbody returned, the earliest one we have
// stands in for it.
export function originalStarts(
  contracts: MindbodyClientContract[],
): Map<number, { originalStartDate: string | null; originalClientContractId: number }> {
  const byId = new Map<number, MindbodyClientContract>();
  for (const contract of contracts) if (typeof contract.Id === "number") byId.set(contract.Id, contract);

  const result = new Map<number, { originalStartDate: string | null; originalClientContractId: number }>();
  for (const [id, contract] of byId) {
    let current = contract;
    let currentId = id;
    const seen = new Set<number>([id]);
    while (typeof current.AutoRenewClientContractID === "number") {
      const previousId = current.AutoRenewClientContractID;
      const previous = byId.get(previousId);
      if (!previous || seen.has(previousId)) break;
      seen.add(previousId);
      current = previous;
      currentId = previousId;
    }
    result.set(id, {
      originalStartDate: toDate(current.StartDate) ?? toDate(current.AgreementDate),
      originalClientContractId: currentId,
    });
  }
  return result;
}

export type UpcomingAutopay = {
  date: string;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  productId: number | null;
};

export type MemberContractRow = {
  mindbody_client_contract_id: number;
  mindbody_client_id: string;
  payer_mindbody_client_id: string | null;
  mindbody_contract_id: number | null;
  contract_name: string;
  agreement_date: string | null;
  start_date: string | null;
  end_date: string | null;
  termination_date: string | null;
  original_start_date: string | null;
  original_client_contract_id: number | null;
  renewed_from_client_contract_id: number | null;
  autopay_status: string | null;
  auto_renewing: boolean | null;
  is_month_to_month: boolean | null;
  normal_autopay_cents: number | null;
  next_bill_date: string | null;
  next_bill_subtotal_cents: number | null;
  next_bill_tax_cents: number | null;
  next_bill_total_cents: number | null;
  upcoming_autopays: UpcomingAutopay[];
};

export function toMemberContractRows(mindbodyClientId: string, contracts: MindbodyClientContract[]): MemberContractRow[] {
  const originals = originalStarts(contracts);
  return contracts
    .filter((contract): contract is MindbodyClientContract & { Id: number } => typeof contract.Id === "number")
    .map((contract) => {
      const upcoming: UpcomingAutopay[] = (contract.UpcomingAutopayEvents ?? [])
        .map((event) => ({
          date: toDate(event.ScheduleDate),
          subtotalCents: toCents(event.Subtotal),
          taxCents: toCents(event.Tax),
          totalCents: toCents(event.ChargeAmount),
          productId: event.ProductId ?? null,
        }))
        .filter((event): event is UpcomingAutopay => Boolean(event.date))
        .sort((a, b) => a.date.localeCompare(b.date));
      const next = upcoming[0];
      const original = originals.get(contract.Id);
      return {
        mindbody_client_contract_id: contract.Id,
        mindbody_client_id: mindbodyClientId,
        payer_mindbody_client_id:
          typeof contract.PayerClientId === "number" && String(contract.PayerClientId) !== mindbodyClientId
            ? String(contract.PayerClientId)
            : null,
        mindbody_contract_id: contract.ContractID ?? null,
        contract_name: (contract.ContractName ?? "").trim() || "Contract",
        agreement_date: toDate(contract.AgreementDate),
        start_date: toDate(contract.StartDate),
        end_date: toDate(contract.EndDate),
        termination_date: toDate(contract.TerminationDate),
        original_start_date: original?.originalStartDate ?? toDate(contract.StartDate),
        original_client_contract_id: original?.originalClientContractId ?? contract.Id,
        renewed_from_client_contract_id: contract.AutoRenewClientContractID ?? null,
        autopay_status: contract.AutopayStatus ?? null,
        auto_renewing: contract.AutoRenewing ?? null,
        is_month_to_month: contract.IsMonthToMonth ?? null,
        normal_autopay_cents: toCents(contract.NormalAutoPay),
        next_bill_date: next?.date ?? null,
        next_bill_subtotal_cents: next?.subtotalCents ?? null,
        next_bill_tax_cents: next?.taxCents ?? null,
        next_bill_total_cents: next?.totalCents ?? null,
        upcoming_autopays: upcoming,
      };
    });
}

// Mindbody's agreement preview is HTML with a sample member's name,
// birthdate and email at the top and a "Member: ... Last 4:" signature
// block. Keep the text from the first real heading on, and blank out the
// signature block and any email addresses.
export function cleanAgreementTerms(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const decoded = raw
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z#0-9]+;/gi, " ");
  let text = decoded.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  const start = text.search(/(Membership Privileges|Pilates Privileges|Membership Type:|Policies:)/);
  if (start > 0) text = text.slice(start);
  text = text
    .replace(/Member:[\s\S]*?Last 4:\s*\S*/g, "Member: [member] Date: [date] Method of Payment: [payment method]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]");
  return text.trim() || null;
}

export function toPlanRow(template: MindbodyContractTemplate & { AgreementTerms?: string | null }) {
  return {
    mindbody_contract_id: template.Id,
    name: template.Name.trim(),
    description: template.Description?.trim() || null,
    recurring_subtotal_cents: toCents(template.RecurringPaymentAmountSubtotal),
    first_payment_subtotal_cents: toCents(template.FirstPaymentAmountSubtotal),
    autopay_frequency: template.AutopaySchedule?.FrequencyTimeUnit ?? null,
    number_of_autopays: template.NumberOfAutopays ?? null,
    after_term: template.ActionUponCompletionOfAutopays ?? null,
    sold_online: template.SoldOnline === true,
    client_can_terminate_online: template.ClientTerminateOnline === true,
    requires_signature: template.RequiresElectronicConfirmation === true,
    members_only: Array.isArray(template.MembershipTypeRestrictions) && template.MembershipTypeRestrictions.length > 0,
    agreement_terms: cleanAgreementTerms(template.AgreementTerms),
  };
}
