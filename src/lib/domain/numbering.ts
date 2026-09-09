import type { DocumentCounters } from "./types";

const pad = (n: number, width = 5) => String(n).padStart(width, "0");

/** Document numbering — TLB-ORD / TLB-SUP / TLB-CUS */
export function nextDocumentNumber(
  kind: "order" | "supply" | "customer",
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
  next.customer += 1;
  return { number: `TLB-CUS-${pad(next.customer, 4)}`, counters: next };
}
