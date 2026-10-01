/**
 * Lightweight Ghana-oriented tax helpers for TLB.
 * Settings decide which taxes apply; default posture is minimal (optional levies Off).
 */

import type { AppliedTaxLine, TaxKind, TaxMode, VatRate } from "./types";

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  active: "Active — apply when calculating totals",
  exempt: "Exempt — never apply",
  off: "Off / Ignored — do not apply",
};

export function normalizeTaxMode(rate: Pick<VatRate, "active" | "mode">): TaxMode {
  if (rate.mode === "active" || rate.mode === "exempt" || rate.mode === "off") return rate.mode;
  return rate.active ? "active" : "off";
}

export function taxKindOf(rate: Pick<VatRate, "kind" | "code">): TaxKind {
  if (rate.kind === "vat" || rate.kind === "levy") return rate.kind;
  const code = rate.code.trim().toUpperCase();
  if (code === "VAT" || code === "CFG") return "vat";
  return "levy";
}

export function withNormalizedTax(rate: VatRate): VatRate {
  const mode = normalizeTaxMode(rate);
  return {
    ...rate,
    mode,
    kind: taxKindOf(rate),
    active: mode === "active",
    sortOrder: rate.sortOrder ?? (taxKindOf(rate) === "vat" ? 0 : 10),
  };
}

/** Seed / migrate catalog: VAT configurable; optional levies Off so the company is not over-taxed. */
export function defaultTaxCatalog(): VatRate[] {
  return [
    {
      id: "vat-configurable",
      code: "VAT",
      label: "VAT (Ghana)",
      ratePercent: 0,
      active: true,
      mode: "active",
      kind: "vat",
      sortOrder: 0,
    },
    {
      id: "levy-nhil",
      code: "NHIL",
      label: "NHIL (optional)",
      ratePercent: 0,
      active: false,
      mode: "off",
      kind: "levy",
      sortOrder: 10,
    },
    {
      id: "levy-getfund",
      code: "GETFund",
      label: "GETFund (optional)",
      ratePercent: 0,
      active: false,
      mode: "off",
      kind: "levy",
      sortOrder: 20,
    },
    {
      id: "levy-covid",
      code: "COVID",
      label: "COVID levy (optional)",
      ratePercent: 0,
      active: false,
      mode: "off",
      kind: "levy",
      sortOrder: 30,
    },
  ];
}

const KNOWN_LEVY_IDS = new Set(["levy-nhil", "levy-getfund", "levy-covid"]);

/** Merge persisted rates with the optional-levy catalog without forcing levies On. */
export function ensureTaxCatalog(rates: VatRate[] | undefined | null): VatRate[] {
  const defaults = defaultTaxCatalog();
  if (!rates?.length) return defaults.map(withNormalizedTax);

  const byId = new Map(rates.map((r) => [r.id, withNormalizedTax(r)]));
  const byCode = new Map(
    rates.map((r) => [r.code.trim().toUpperCase(), withNormalizedTax(r)] as const),
  );

  // Preserve existing VAT / CFG row as the primary VAT definition.
  const existingVat =
    [...byId.values()].find((r) => taxKindOf(r) === "vat") ??
    byCode.get("VAT") ??
    byCode.get("CFG") ??
    byId.get("vat-configurable");

  const merged: VatRate[] = [];
  if (existingVat) {
    merged.push(
      withNormalizedTax({
        ...existingVat,
        kind: "vat",
        code: existingVat.code === "CFG" ? "VAT" : existingVat.code,
        label:
          existingVat.code === "CFG" || existingVat.label.includes("Configured VAT")
            ? "VAT (Ghana)"
            : existingVat.label,
        sortOrder: 0,
      }),
    );
  } else {
    merged.push(defaults[0]!);
  }

  for (const levy of defaults.filter((d) => d.kind === "levy")) {
    const found = byId.get(levy.id) ?? byCode.get(levy.code.toUpperCase());
    if (found) {
      const levyMode =
        found.mode === "active" ? "active" : found.mode === "exempt" ? "exempt" : "off";
      merged.push(
        withNormalizedTax({
          ...found,
          kind: "levy",
          // Never auto-activate optional levies on migrate.
          mode: levyMode,
          active: levyMode === "active",
          sortOrder: levy.sortOrder ?? found.sortOrder ?? 10,
        }),
      );
    } else {
      merged.push(levy);
    }
  }

  // Keep any custom rates the Owner added (not in the known levy set / not VAT).
  for (const rate of byId.values()) {
    if (merged.some((m) => m.id === rate.id)) continue;
    if (KNOWN_LEVY_IDS.has(rate.id)) continue;
    if (taxKindOf(rate) === "vat") continue;
    merged.push(withNormalizedTax(rate));
  }

  return merged.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function listApplicableTaxes(
  rates: VatRate[],
  opts?: { customerTaxExempt?: boolean; documentTaxExempt?: boolean },
): VatRate[] {
  if (opts?.customerTaxExempt || opts?.documentTaxExempt) return [];
  return ensureTaxCatalog(rates)
    .filter((r) => normalizeTaxMode(r) === "active" && r.ratePercent > 0)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function primaryVatRate(rates: VatRate[]): VatRate | undefined {
  return ensureTaxCatalog(rates).find((r) => taxKindOf(r) === "vat");
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function taxAmountOn(subtotal: number, ratePercent: number): number {
  return roundMoney(subtotal * (ratePercent / 100));
}

export type TaxComputation = {
  breakdown: AppliedTaxLine[];
  vatAmount: number;
  otherTaxAmount: number;
  totalTax: number;
  /** Prefer the primary active VAT id when present; else first applied; else "". */
  vatRateId: string;
};

export function computeTaxesOnAmount(
  subtotal: number,
  rates: VatRate[],
  opts?: { customerTaxExempt?: boolean; documentTaxExempt?: boolean },
): TaxComputation {
  const applicable = listApplicableTaxes(rates, opts);
  const breakdown: AppliedTaxLine[] = applicable.map((t) => ({
    taxId: t.id,
    code: t.code,
    label: t.label,
    ratePercent: t.ratePercent,
    amount: taxAmountOn(subtotal, t.ratePercent),
    kind: taxKindOf(t),
  }));

  const vatAmount = roundMoney(
    breakdown.filter((b) => b.kind === "vat").reduce((s, b) => s + b.amount, 0),
  );
  const otherTaxAmount = roundMoney(
    breakdown.filter((b) => b.kind !== "vat").reduce((s, b) => s + b.amount, 0),
  );
  const primary = applicable.find((t) => taxKindOf(t) === "vat") ?? applicable[0];
  const catalogVat = primaryVatRate(rates);

  return {
    breakdown,
    vatAmount,
    otherTaxAmount,
    totalTax: roundMoney(vatAmount + otherTaxAmount),
    vatRateId: primary?.id ?? catalogVat?.id ?? "",
  };
}

/** Line-level VAT column: only the VAT portion (levies shown on document totals). */
export function lineVatAmount(
  lineSubtotal: number,
  rates: VatRate[],
  opts?: { customerTaxExempt?: boolean; documentTaxExempt?: boolean },
): number {
  const vat = listApplicableTaxes(rates, opts).find((t) => taxKindOf(t) === "vat");
  if (!vat) return 0;
  return taxAmountOn(lineSubtotal, vat.ratePercent);
}

export function estimateDocumentTax(
  baseAmount: number,
  rates: VatRate[],
  opts?: { customerTaxExempt?: boolean; documentTaxExempt?: boolean },
): TaxComputation {
  return computeTaxesOnAmount(baseAmount, rates, opts);
}
