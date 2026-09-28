import { tryIssueDocumentNumber } from "../repo/ledger-rpc";
import type { DocumentCounters } from "./types";

const pad = (n: number, width = 5) => String(n).padStart(width, "0");

/**
 * First commercial document sequence to issue (e.g. TLB-ORD-YYMM-00125).
 * Counters store the last-used value, so floor them at START - 1.
 */
export const MATURE_SEQUENCE_START = 125;
export const MATURE_SEQUENCE_FLOOR = MATURE_SEQUENCE_START - 1;

/** Raise low commercial counters so the next number is at least MATURE_SEQUENCE_START. */
export function floorMatureCommercialCounters(c: DocumentCounters): DocumentCounters {
  const floor = (n: number | undefined) => Math.max(n ?? 0, MATURE_SEQUENCE_FLOOR);
  return {
    ...c,
    order: floor(c.order),
    supply: floor(c.supply),
    invoice: floor(c.invoice),
    receipt: floor(c.receipt),
    delivery: floor(c.delivery),
    payment: floor(c.payment),
    quotation: floor(c.quotation),
    opsRequest: floor(c.opsRequest),
  };
}

export type DocumentKind =
  | "order"
  | "supply"
  | "customer"
  | "supplier"
  | "supplierPo"
  | "supplierReceipt"
  | "supplierPayment"
  | "invoice"
  | "receipt"
  | "delivery"
  | "payment"
  | "quotation"
  | "stockMovement"
  | "stockIssue"
  | "transfer"
  | "adjustment"
  | "batch"
  | "customerReturn"
  | "supplierReturn"
  | "nonPoPurchase"
  | "importShipment"
  | "exportShipment"
  | "opsRequest";

/**
 * Document numbering — TLB-ORD / TLB-QTE / TLB-SUP / TLB-CUS / TLB-VEN / TLB-PO / TLB-GRN / TLB-SPAY / …
 * When Supabase is configured and issue_document_number succeeds, the server
 * number is the one returned. Otherwise the local counter format is kept.
 */
export function nextDocumentNumber(
  kind: DocumentKind,
  counters: DocumentCounters,
  now = new Date(),
): { number: string; counters: DocumentCounters } {
  const local = nextLocalDocumentNumber(kind, counters, now);
  // Movement numbers are allocated inside post_movement, not here.
  if (kind === "stockMovement") return local;
  const issued = tryIssueDocumentNumber(kind);
  if (issued) return { number: issued, counters: local.counters };
  return local;
}

function nextLocalDocumentNumber(
  kind: DocumentKind,
  counters: DocumentCounters,
  now = new Date(),
): { number: string; counters: DocumentCounters } {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const next = { ...counters };

  if (kind === "order") {
    next.order += 1;
    return { number: `TLB-ORD-${yy}${mm}-${pad(next.order)}`, counters: next };
  }
  if (kind === "quotation") {
    next.quotation += 1;
    return { number: `TLB-QTE-${yy}${mm}-${pad(next.quotation)}`, counters: next };
  }
  if (kind === "supply") {
    next.supply += 1;
    return { number: `TLB-SUP-${yy}${mm}-${pad(next.supply)}`, counters: next };
  }
  if (kind === "invoice") {
    next.invoice += 1;
    return { number: `TLB-INV-${yy}${mm}-${pad(next.invoice)}`, counters: next };
  }
  if (kind === "receipt") {
    next.receipt += 1;
    return { number: `TLB-RCT-${yy}${mm}-${pad(next.receipt)}`, counters: next };
  }
  if (kind === "delivery") {
    next.delivery += 1;
    return { number: `TLB-DLV-${yy}${mm}-${pad(next.delivery)}`, counters: next };
  }
  if (kind === "payment") {
    next.payment += 1;
    return { number: `TLB-PAY-${yy}${mm}-${pad(next.payment)}`, counters: next };
  }
  if (kind === "supplier") {
    next.supplier += 1;
    return { number: `TLB-VEN-${pad(next.supplier, 4)}`, counters: next };
  }
  if (kind === "supplierPo") {
    next.supplierPo += 1;
    return { number: `TLB-PO-${yy}${mm}-${pad(next.supplierPo)}`, counters: next };
  }
  if (kind === "supplierReceipt") {
    next.supplierReceipt += 1;
    return { number: `TLB-GRN-${yy}${mm}-${pad(next.supplierReceipt)}`, counters: next };
  }
  if (kind === "supplierPayment") {
    next.supplierPayment += 1;
    return { number: `TLB-SPAY-${yy}${mm}-${pad(next.supplierPayment)}`, counters: next };
  }
  if (kind === "stockMovement") {
    next.stockMovement = (next.stockMovement ?? 0) + 1;
    return { number: `TLB-MV-${yy}${mm}-${pad(next.stockMovement)}`, counters: next };
  }
  if (kind === "stockIssue") {
    next.stockIssue = (next.stockIssue ?? 0) + 1;
    return { number: `TLB-ISS-${yy}${mm}-${pad(next.stockIssue)}`, counters: next };
  }
  if (kind === "transfer") {
    next.transfer = (next.transfer ?? 0) + 1;
    return { number: `TLB-TR-${yy}${mm}-${pad(next.transfer)}`, counters: next };
  }
  if (kind === "adjustment") {
    next.adjustment = (next.adjustment ?? 0) + 1;
    return { number: `TLB-ADJ-${yy}${mm}-${pad(next.adjustment)}`, counters: next };
  }
  if (kind === "batch") {
    next.batch = (next.batch ?? 0) + 1;
    return { number: `TLB-BAT-${yy}${mm}-${pad(next.batch)}`, counters: next };
  }
  if (kind === "customerReturn") {
    next.customerReturn = (next.customerReturn ?? 0) + 1;
    return { number: `TLB-CRT-${yy}${mm}-${pad(next.customerReturn)}`, counters: next };
  }
  if (kind === "supplierReturn") {
    next.supplierReturn = (next.supplierReturn ?? 0) + 1;
    return { number: `TLB-SRT-${yy}${mm}-${pad(next.supplierReturn)}`, counters: next };
  }
  if (kind === "nonPoPurchase") {
    next.nonPoPurchase = (next.nonPoPurchase ?? 0) + 1;
    return { number: `TLB-NPO-${yy}${mm}-${pad(next.nonPoPurchase)}`, counters: next };
  }
  if (kind === "importShipment") {
    next.importShipment = (next.importShipment ?? 0) + 1;
    return { number: `TLB-IMP-${yy}${mm}-${pad(next.importShipment)}`, counters: next };
  }
  if (kind === "exportShipment") {
    next.exportShipment = (next.exportShipment ?? 0) + 1;
    return { number: `TLB-EXP-${yy}${mm}-${pad(next.exportShipment)}`, counters: next };
  }
  if (kind === "opsRequest") {
    next.opsRequest = (next.opsRequest ?? 0) + 1;
    return { number: `TLB-REQ-${yy}${mm}-${pad(next.opsRequest)}`, counters: next };
  }
  next.customer += 1;
  return { number: `TLB-CUS-${pad(next.customer, 4)}`, counters: next };
}
