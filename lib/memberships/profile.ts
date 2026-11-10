import { toCents, toDate } from "@/lib/memberships/contracts";

// Pure conversion of Mindbody's client visits, purchases and services into
// SynqIQ rows (no I/O, unit-tested in tests/member-profile.test.ts). Used by
// lib/sync/member-profile.ts.

export type MindbodyVisit = {
  Id: number;
  ClientId?: string | null;
  Name?: string | null;
  StartDateTime?: string | null;
  EndDateTime?: string | null;
  ClassId?: number | null;
  AppointmentId?: number | null;
  AppointmentStatus?: string | null;
  ServiceName?: string | null;
  TypeTaken?: string | null;
  StaffId?: number | null;
  LocationId?: number | null;
  SignedIn?: boolean | null;
  LateCancelled?: boolean | null;
  Missed?: boolean | null;
  WebSignup?: boolean | null;
  LastModifiedDateTime?: string | null;
};

export type MindbodyPurchasedItem = {
  SaleDetailId: number;
  Id?: number | null;
  IsService?: boolean | null;
  Description?: string | null;
  ContractId?: number | null;
  UnitPrice?: number | null;
  Quantity?: number | null;
  DiscountAmount?: number | null;
  TaxAmount?: number | null;
  TotalAmount?: number | null;
  Returned?: boolean | null;
  RecipientClientId?: number | null;
};

export type MindbodyClientPurchase = {
  Sale?: {
    Id: number;
    SaleDateTime?: string | null;
    SalesRepId?: number | null;
    LocationId?: number | null;
    PurchasedItems?: MindbodyPurchasedItem[] | null;
    Payments?: { Method?: number | null; Type?: string | null; Amount?: number | null }[] | null;
  } | null;
};

export type MindbodyClientService = {
  Id: number;
  ProductId?: number | null;
  Name?: string | null;
  Program?: { Name?: string | null } | null;
  Count?: number | null;
  Remaining?: number | null;
  Current?: boolean | null;
  ActiveDate?: string | null;
  ExpirationDate?: string | null;
  PaymentDate?: string | null;
  Returned?: boolean | null;
};

// "2026-05-07T05:15:21" (studio-local) -> same, seconds kept; null if absent.
const toLocal = (value: string | null | undefined): string | null =>
  value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !value.startsWith("0001-") ? value.slice(0, 19) : null;
const positive = (value: number | null | undefined) => (typeof value === "number" && value > 0 ? value : null);

export function visitKind(visit: Pick<MindbodyVisit, "Name" | "ClassId" | "AppointmentId">): "arrival" | "class" | "appointment" | "other" {
  if (positive(visit.AppointmentId)) return "appointment";
  if (positive(visit.ClassId)) return "class";
  if ((visit.Name ?? "").trim().toLowerCase() === "arrival") return "arrival";
  return "other";
}

export function toVisitRow(organizationId: string, mindbodyClientId: string, visit: MindbodyVisit) {
  const start = toLocal(visit.StartDateTime);
  if (!start || !visit.Id) return null;
  return {
    organization_id: organizationId,
    mindbody_visit_id: visit.Id,
    mindbody_client_id: mindbodyClientId,
    kind: visitKind(visit),
    name: (visit.Name ?? "").trim() || "Visit",
    start_local: start,
    end_local: toLocal(visit.EndDateTime),
    service_name: visit.ServiceName ?? visit.TypeTaken ?? null,
    staff_mindbody_id: positive(visit.StaffId),
    location_id: positive(visit.LocationId),
    class_id: positive(visit.ClassId),
    appointment_id: positive(visit.AppointmentId),
    appointment_status: positive(visit.AppointmentId) ? (visit.AppointmentStatus ?? null) : null,
    signed_in: visit.SignedIn ?? null,
    late_cancelled: visit.LateCancelled ?? null,
    missed: visit.Missed ?? null,
    web_signup: visit.WebSignup ?? null,
    last_modified_at: toLocal(visit.LastModifiedDateTime),
  };
}

// Mindbody lists one purchase per line item, each repeating its whole sale:
// one row per sale (with payments) and one per line, deduplicated.
export function toSaleRows(organizationId: string, mindbodyClientId: string, purchases: MindbodyClientPurchase[]) {
  const sales = new Map<number, Record<string, unknown>>();
  const items = new Map<number, Record<string, unknown>>();
  for (const purchase of purchases) {
    const sale = purchase.Sale;
    if (!sale?.Id) continue;
    for (const item of sale.PurchasedItems ?? []) {
      if (!item.SaleDetailId || items.has(item.SaleDetailId)) continue;
      items.set(item.SaleDetailId, {
        organization_id: organizationId,
        mindbody_sale_id: sale.Id,
        mindbody_sale_detail_id: item.SaleDetailId,
        description: (item.Description ?? "").trim() || "Item",
        is_service: item.IsService ?? null,
        product_id: positive(item.Id),
        contract_id: positive(item.ContractId),
        quantity: item.Quantity ?? null,
        unit_price_cents: toCents(item.UnitPrice),
        discount_cents: toCents(item.DiscountAmount),
        tax_cents: toCents(item.TaxAmount),
        total_cents: toCents(item.TotalAmount),
        returned: item.Returned === true,
        recipient_unique_id: positive(item.RecipientClientId),
      });
    }
    if (!sales.has(sale.Id)) {
      sales.set(sale.Id, {
        organization_id: organizationId,
        mindbody_sale_id: sale.Id,
        mindbody_client_id: mindbodyClientId,
        sale_at: sale.SaleDateTime ?? null,
        location_id: positive(sale.LocationId),
        sales_rep_mindbody_id: positive(sale.SalesRepId),
        total_cents: (sale.PurchasedItems ?? []).reduce((sum, item) => sum + (toCents(item.TotalAmount) ?? 0), 0),
        payments: (sale.Payments ?? []).map((payment) => ({
          method: payment.Method ?? null,
          type: payment.Type ?? null,
          amountCents: toCents(payment.Amount),
        })),
      });
    }
  }
  return { sales: [...sales.values()], items: [...items.values()] };
}

export function toServiceRow(organizationId: string, mindbodyClientId: string, service: MindbodyClientService) {
  if (!service.Id) return null;
  return {
    organization_id: organizationId,
    mindbody_client_service_id: service.Id,
    mindbody_client_id: mindbodyClientId,
    product_id: positive(service.ProductId),
    name: (service.Name ?? "").trim() || "Service",
    program: service.Program?.Name ?? null,
    count: typeof service.Count === "number" ? service.Count : null,
    remaining: typeof service.Remaining === "number" ? service.Remaining : null,
    is_current: service.Current ?? null,
    active_date: toDate(service.ActiveDate),
    expiration_date: toDate(service.ExpirationDate),
    payment_date: toDate(service.PaymentDate),
    returned: service.Returned ?? null,
  };
}

// Mindbody marks unlimited passes with a huge session count (99999, 999999).
export const isUnlimited = (count: number | null) => count !== null && count >= 9999;
