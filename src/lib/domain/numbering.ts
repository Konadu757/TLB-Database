import type { DocumentCounters } from "./types";

const pad = (n: number, width = 5) => String(n).padStart(width, "0");

export type DocumentKind =
  | "order"
  | "supply"
  | "customer"
  | "invoice"
  | "receipt"
  | "delivery"
  | "payment";

/** Document numbering — TLB-ORD / TLB-SUP / TLB-CUS / TLB-INV / TLB-RCT / TLB-DLV / TLB-PAY */
export function nextDocumentNumber(
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
  next.customer += 1;
  return { number: `TLB-CUS-${pad(next.customer, 4)}`, counters: next };
}
