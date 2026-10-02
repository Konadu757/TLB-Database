import type { QuotationLine } from "./types";

/** Round to 2 decimal places (GHS). */
export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Quantity × unit price → line total (ex-tax). */
export function calcLineTotal(qty: number, unitPrice: number): number {
  return roundMoney(qty * unitPrice);
}

/** Sum of line totals → quotation subtotal (ex-tax). */
export function calcQuotationSubtotal(
  lines: ReadonlyArray<Pick<QuotationLine, "amount"> | { qty: number; unitPrice: number }>,
): number {
  return roundMoney(
    lines.reduce((sum, line) => {
      if ("amount" in line && typeof line.amount === "number") {
        return sum + line.amount;
      }
      const qty = "qty" in line ? Number(line.qty) : 0;
      const unitPrice = "unitPrice" in line ? Number(line.unitPrice) : 0;
      return sum + calcLineTotal(qty, unitPrice);
    }, 0),
  );
}

export type QuotationLineInput = {
  id?: string;
  itemLabel: string;
  qty: number;
  unitPrice: number;
  note?: string;
};

let lineSeq = 0;

function nextLineId(): string {
  lineSeq += 1;
  return `qtl-${Date.now().toString(36)}-${lineSeq}`;
}

/** Normalize draft/API lines into stored QuotationLine rows with calculated amounts. */
export function buildQuotationLines(inputs: readonly QuotationLineInput[]): QuotationLine[] {
  return inputs.map((input) => {
    const itemLabel = input.itemLabel.trim();
    const qty = Number(input.qty);
    const unitPrice = Number(input.unitPrice);
    const amount = calcLineTotal(qty, unitPrice);
    const note = input.note?.trim();
    return {
      id: input.id?.trim() || nextLineId(),
      itemLabel,
      qty,
      unitPrice,
      amount,
      ...(note ? { note } : {}),
    };
  });
}

/** Denormalized rollup fields for list/search (first line + summed total). */
export function rollupQuotationLines(lines: readonly QuotationLine[]): {
  itemLabel: string;
  qty: number;
  unitPrice: number;
  amount: number;
} {
  const first = lines[0];
  return {
    itemLabel: first?.itemLabel ?? "",
    qty: first?.qty ?? 0,
    unitPrice: first?.unitPrice ?? 0,
    amount: calcQuotationSubtotal(lines),
  };
}

/** Ensure a quotation always has a lines[] array (legacy flat quotes → one line). */
export function ensureQuotationLines(q: {
  id: string;
  itemLabel?: string;
  qty?: number;
  unitPrice?: number;
  amount?: number;
  lines?: QuotationLine[];
}): QuotationLine[] {
  if (Array.isArray(q.lines) && q.lines.length > 0) {
    return buildQuotationLines(
      q.lines.map((l) => ({
        id: l.id,
        itemLabel: l.itemLabel,
        qty: l.qty,
        unitPrice: l.unitPrice,
        ...(l.note ? { note: l.note } : {}),
      })),
    );
  }
  const itemLabel = (q.itemLabel ?? "").trim() || "Quoted item";
  const qty = Number(q.qty) > 0 ? Number(q.qty) : 1;
  const unitPrice =
    Number.isFinite(Number(q.unitPrice)) && Number(q.unitPrice) >= 0
      ? Number(q.unitPrice)
      : q.amount != null && qty > 0
        ? roundMoney(Number(q.amount) / qty)
        : 0;
  return buildQuotationLines([
    {
      id: `${q.id}-line`,
      itemLabel,
      qty,
      unitPrice,
    },
  ]);
}
