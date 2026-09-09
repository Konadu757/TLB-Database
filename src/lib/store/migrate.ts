import type {
  AgeingSettings,
  AppRole,
  CompanyProfile,
  DocumentCounters,
  TlbState,
  VatRate,
} from "../domain/types";
import { createSeedState } from "./seed";

const DEFAULT_COMPANY: CompanyProfile = {
  legalName: "TLB Enterprise Limited",
  tradingName: "TLB Enterprise",
  address: "Industrial Area, Tema, Ghana",
  phone: "+233 30 200 0000",
  email: "accounts@tlb.gh",
  logoNote: "Use company logo from brand assets",
};

const DEFAULT_VAT: VatRate[] = [
  {
    id: "vat-configurable",
    code: "CFG",
    label: "Configured VAT (set in Settings)",
    ratePercent: 0,
    active: true,
  },
];

const DEFAULT_AGEING: AgeingSettings = {
  normalMaxDays: 2,
  attentionMaxDays: 7,
  extendedUnfulfilledDays: 14,
  expectedApproachingDays: 2,
};

const DEFAULT_COUNTERS: DocumentCounters = {
  order: 0,
  supply: 0,
  customer: 0,
  invoice: 0,
  receipt: 0,
  delivery: 0,
  payment: 0,
};

/** Upgrade legacy localStorage payloads without wiping demo data. */
export function migrateState(raw: unknown): TlbState {
  if (!raw || typeof raw !== "object") return createSeedState();
  const parsed = raw as Partial<TlbState> & { version?: number };
  const seed = createSeedState();
  const priorVersion = parsed.version ?? 0;

  const counters: DocumentCounters = {
    ...DEFAULT_COUNTERS,
    ...(parsed.counters ?? {}),
    invoice: parsed.counters?.invoice ?? 0,
    receipt: parsed.counters?.receipt ?? 0,
    delivery: parsed.counters?.delivery ?? 0,
    payment: parsed.counters?.payment ?? 0,
  };

  const ageing: AgeingSettings = {
    ...DEFAULT_AGEING,
    ...(parsed.ageing ?? {}),
    extendedUnfulfilledDays: parsed.ageing?.extendedUnfulfilledDays ?? DEFAULT_AGEING.extendedUnfulfilledDays,
    expectedApproachingDays: parsed.ageing?.expectedApproachingDays ?? DEFAULT_AGEING.expectedApproachingDays,
  };

  // v3: seed dated collections when upgrading from empty finance ledgers.
  const needsCollectionSeed =
    priorVersion < 3 && !(parsed.payments?.length) && !(parsed.receipts?.length);

  return {
    version: 3,
    warehouses: parsed.warehouses?.length ? parsed.warehouses : seed.warehouses,
    products: parsed.products?.length ? parsed.products : seed.products,
    stock: parsed.stock?.length ? parsed.stock : seed.stock,
    customers: parsed.customers?.length ? parsed.customers : seed.customers,
    orders: (parsed.orders?.length ? parsed.orders : seed.orders).map((o) => ({ ...o })),
    orderLines: parsed.orderLines?.length ? parsed.orderLines : seed.orderLines,
    supplies: parsed.supplies ?? [],
    supplyLines: parsed.supplyLines ?? [],
    invoices: parsed.invoices ?? [],
    invoiceLines: parsed.invoiceLines ?? [],
    receipts: needsCollectionSeed ? seed.receipts : (parsed.receipts ?? []),
    receiptLines: needsCollectionSeed ? seed.receiptLines : (parsed.receiptLines ?? []),
    deliveries: parsed.deliveries ?? [],
    deliveryItems: parsed.deliveryItems ?? [],
    payments: needsCollectionSeed ? seed.payments : (parsed.payments ?? []),
    notifications: parsed.notifications ?? [],
    reservations: parsed.reservations ?? [],
    audit: parsed.audit ?? [],
    counters: needsCollectionSeed
      ? {
          ...counters,
          receipt: Math.max(counters.receipt, seed.counters.receipt),
          payment: Math.max(counters.payment, seed.counters.payment),
        }
      : counters,
    ageing,
    company: parsed.company ?? DEFAULT_COMPANY,
    vatRates: parsed.vatRates?.length ? parsed.vatRates : DEFAULT_VAT,
    currentUser: parsed.currentUser ?? "Kwame Asare",
    currentRole: (parsed.currentRole as AppRole) ?? "Manager",
  };
}

export { DEFAULT_COMPANY, DEFAULT_VAT, DEFAULT_AGEING };
