import type { DateRange } from "./period-range";
import { isoInRange } from "./period-range";

/** Demo clock dates aligned with seed / dashboard (2026-09-09). */
const TODAY = "2026-09-09T08:40:00.000Z";
const THIS_WEEK = "2026-09-08T11:00:00.000Z";
const THIS_MONTH = "2026-09-02T10:00:00.000Z";
const THIS_QUARTER = "2026-08-14T09:00:00.000Z";
const THIS_YEAR = "2026-03-18T10:00:00.000Z";
const PREV_MONTH = "2026-08-28T14:00:00.000Z";

export type ListTone = "success" | "warning" | "info" | "danger" | "neutral";

export interface CatalogLine {
  id: string;
  label: string;
  qty?: number;
  amount?: number;
  note?: string;
}

export interface CatalogEvent {
  id: string;
  at: string;
  label: string;
  detail: string;
}

export interface CatalogRecord {
  id: string;
  module: string;
  primary: string;
  secondary: string;
  status: string;
  tone: ListTone;
  /** Primary date used for period filtering. */
  date: string;
  searchText: string;
  fields: Array<{ label: string; value: string }>;
  summary?: Array<{ label: string; value: string; note?: string }>;
  lines?: CatalogLine[];
  history?: CatalogEvent[];
}

function money(n: number): string {
  return `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQuoteDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Map a stored quotation into the catalog list/detail shape. */
export function quotationToCatalogRecord(q: {
  id: string;
  number: string;
  customerName: string;
  contact?: string;
  itemLabel: string;
  qty: number;
  amount: number;
  paymentTerms: string;
  notes?: string;
  status: string;
  quoteDate: string;
  validUntil: string;
  preparedBy: string;
}): CatalogRecord {
  return {
    id: q.id,
    module: "Quotations",
    primary: q.number,
    secondary: `${q.customerName} · ${q.itemLabel}`,
    status: q.status,
    tone: q.status === "Draft" ? "warning" : q.status === "Sent" ? "info" : "neutral",
    date: q.quoteDate,
    searchText: `${q.number} ${q.customerName} ${q.itemLabel} ${q.status} ${q.contact ?? ""}`,
    fields: [
      { label: "Customer", value: q.customerName },
      ...(q.contact ? [{ label: "Contact", value: q.contact }] : []),
      { label: "Quote date", value: formatQuoteDate(q.quoteDate) },
      { label: "Valid until", value: formatQuoteDate(q.validUntil) },
      { label: "Prepared by", value: q.preparedBy },
      { label: "Payment terms", value: q.paymentTerms },
      ...(q.notes ? [{ label: "Notes", value: q.notes }] : []),
    ],
    summary: [
      { label: "Total", value: money(q.amount), note: "ex-VAT" },
      { label: "Lines", value: "1" },
      { label: "Status", value: q.status },
      { label: "Quote #", value: q.number },
    ],
    lines: [{ id: `${q.id}-line`, label: q.itemLabel, qty: q.qty, amount: q.amount }],
    history: [
      {
        id: `${q.id}-created`,
        at: q.quoteDate,
        label: "Created",
        detail: `Quotation ${q.number} opened`,
      },
    ],
  };
}

/** Quotations with dates that diverge across Today / Week / Month / Quarter / Year. */
export const QUOTATION_RECORDS: CatalogRecord[] = [
  {
    id: "qt-today",
    module: "Quotations",
    primary: "QT-260441",
    secondary: "Korle Vista Medical Centre · Hydrochloric Acid 32%",
    status: "Sent",
    tone: "info",
    date: TODAY,
    searchText: "QT-260441 Korle Vista HCl Hydrochloric Acid Sent Hospital",
    fields: [
      { label: "Customer", value: "Korle Vista Medical Centre" },
      { label: "Contact", value: "Dr. Kofi Owusu · procurement@korlevista.gh" },
      { label: "Quote date", value: "09 Sep 2026" },
      { label: "Valid until", value: "23 Sep 2026" },
      { label: "Prepared by", value: "TLB Owner" },
      { label: "Payment terms", value: "Net 30" },
      { label: "Notes", value: "Theatre stores top-up — awaiting written acceptance." },
    ],
    summary: [
      { label: "Total", value: money(3840), note: "ex-VAT" },
      { label: "Lines", value: "1" },
      { label: "Status", value: "Sent" },
      { label: "Age", value: "0d", note: "issued today" },
    ],
    lines: [{ id: "qtl-1", label: "Hydrochloric Acid 32%", qty: 6, amount: 3840, note: "CHEM-001 · drums" }],
    history: [
      { id: "qth-1", at: TODAY, label: "Sent", detail: "Emailed to procurement@korlevista.gh" },
      { id: "qth-2", at: TODAY, label: "Created", detail: "Draft raised from customer enquiry" },
    ],
  },
  {
    id: "qt-week",
    module: "Quotations",
    primary: "QT-260438",
    secondary: "Achimota Science Academy · Ethanol 96%",
    status: "Draft",
    tone: "warning",
    date: THIS_WEEK,
    searchText: "QT-260438 Achimota Science Academy Ethanol Draft Educational",
    fields: [
      { label: "Customer", value: "Achimota Science Academy" },
      { label: "Contact", value: "Lab stores · labs@achimota.edu.gh" },
      { label: "Quote date", value: "08 Sep 2026" },
      { label: "Valid until", value: "22 Sep 2026" },
      { label: "Prepared by", value: "Ama Mensah" },
      { label: "Payment terms", value: "Net 15" },
      { label: "Notes", value: "School lab restock — still in internal review." },
    ],
    summary: [
      { label: "Total", value: money(15000), note: "ex-VAT" },
      { label: "Lines", value: "1" },
      { label: "Status", value: "Draft" },
      { label: "Age", value: "1d" },
    ],
    lines: [{ id: "qtl-2", label: "Ethanol 96%", qty: 12, amount: 15000, note: "CHEM-014 · drums" }],
    history: [{ id: "qth-3", at: THIS_WEEK, label: "Created", detail: "Draft quotation opened" }],
  },
  {
    id: "qt-month",
    module: "Quotations",
    primary: "QT-260401",
    secondary: "Demo Chemical Labs · Chemical A + B package",
    status: "Accepted",
    tone: "success",
    date: THIS_MONTH,
    searchText: "QT-260401 Demo Chemical Labs Chemical A B Accepted Laboratory",
    fields: [
      { label: "Customer", value: "Demo Chemical Labs" },
      { label: "Contact", value: "Ama Mensah · ama@demochem.gh" },
      { label: "Quote date", value: "02 Sep 2026" },
      { label: "Valid until", value: "16 Sep 2026" },
      { label: "Prepared by", value: "TLB Owner" },
      { label: "Payment terms", value: "Net 30" },
      { label: "Notes", value: "Accepted — convert to TLB-ORD-2609-00101 when stock clears." },
    ],
    summary: [
      { label: "Total", value: money(16600), note: "ex-VAT" },
      { label: "Lines", value: "2" },
      { label: "Status", value: "Accepted" },
      { label: "Age", value: "7d" },
    ],
    lines: [
      { id: "qtl-3", label: "Chemical A", qty: 4, amount: 7400, note: "CHEM-A" },
      { id: "qtl-4", label: "Chemical B", qty: 10, amount: 9200, note: "CHEM-B" },
    ],
    history: [
      { id: "qth-4", at: THIS_MONTH, label: "Accepted", detail: "Customer signed commercially" },
      { id: "qth-5", at: THIS_MONTH, label: "Sent", detail: "PDF issued to ama@demochem.gh" },
    ],
  },
  {
    id: "qt-quarter",
    module: "Quotations",
    primary: "QT-260312",
    secondary: "Apex Analytical Labs · Ethanol campaign",
    status: "Converted",
    tone: "success",
    date: THIS_QUARTER,
    searchText: "QT-260312 Apex Analytical Labs Ethanol Converted",
    fields: [
      { label: "Customer", value: "Apex Analytical Labs" },
      { label: "Contact", value: "Efua Boateng · orders@apexlabs.gh" },
      { label: "Quote date", value: "14 Aug 2026" },
      { label: "Valid until", value: "28 Aug 2026" },
      { label: "Converted order", value: "TLB-ORD-2608-00104" },
      { label: "Payment terms", value: "Net 15" },
      { label: "Notes", value: "Converted to sales order; partial supply still open." },
    ],
    summary: [
      { label: "Total", value: money(25600), note: "ex-VAT" },
      { label: "Lines", value: "1" },
      { label: "Status", value: "Converted" },
      { label: "Age", value: "26d" },
    ],
    lines: [{ id: "qtl-5", label: "Hydrochloric Acid 32%", qty: 40, amount: 25600, note: "CHEM-001" }],
    history: [
      { id: "qth-6", at: THIS_QUARTER, label: "Converted", detail: "Linked to TLB-ORD-2608-00104" },
      { id: "qth-7", at: THIS_QUARTER, label: "Accepted", detail: "Verbal + email confirmation" },
    ],
  },
  {
    id: "qt-year",
    module: "Quotations",
    primary: "QT-260118",
    secondary: "Apex Analytical Labs · Q1 solvent package",
    status: "Expired",
    tone: "warning",
    date: THIS_YEAR,
    searchText: "QT-260118 Apex Analytical Expired solvent",
    fields: [
      { label: "Customer", value: "Apex Analytical Labs" },
      { label: "Contact", value: "Efua Boateng" },
      { label: "Quote date", value: "18 Mar 2026" },
      { label: "Valid until", value: "01 Apr 2026" },
      { label: "Prepared by", value: "TLB Owner" },
      { label: "Payment terms", value: "Net 15" },
      { label: "Notes", value: "Expired without conversion — superseded by later campaign quote." },
    ],
    summary: [
      { label: "Total", value: money(37500), note: "ex-VAT" },
      { label: "Lines", value: "1" },
      { label: "Status", value: "Expired" },
      { label: "Age", value: "175d" },
    ],
    lines: [{ id: "qtl-6", label: "Ethanol 96%", qty: 30, amount: 37500, note: "CHEM-014" }],
    history: [{ id: "qth-8", at: THIS_YEAR, label: "Expired", detail: "Validity window closed" }],
  },
];

/** Other sandbox modules that previously used the tiny inspector. */
export const SANDBOX_RECORDS: CatalogRecord[] = [
  // Batches
  {
    id: "batch-hcl",
    module: "Batches",
    primary: "HCL-26001",
    secondary: "Main Warehouse · 240 drums",
    status: "Released",
    tone: "success",
    date: THIS_MONTH,
    searchText: "HCL-26001 Hydrochloric Acid Main Warehouse Released",
    fields: [
      { label: "Product", value: "Hydrochloric Acid 32%" },
      { label: "Warehouse", value: "Main Warehouse" },
      { label: "Qty", value: "240 drums" },
      { label: "Released", value: "02 Sep 2026" },
      { label: "QC", value: "Pass · assay within spec" },
      { label: "Notes", value: "Available for sales allocation." },
    ],
    summary: [
      { label: "On hand", value: "240" },
      { label: "Reserved", value: "12" },
      { label: "Status", value: "Released" },
      { label: "Age", value: "7d" },
    ],
    history: [
      { id: "bh1", at: THIS_MONTH, label: "Released", detail: "QC cleared for sales" },
      { id: "bh2", at: THIS_MONTH, label: "Received", detail: "GRN from production" },
    ],
  },
  {
    id: "batch-eth",
    module: "Batches",
    primary: "ETH-26018",
    secondary: "Expires in 42 days",
    status: "Watch",
    tone: "warning",
    date: THIS_WEEK,
    searchText: "ETH-26018 Ethanol Watch expiry",
    fields: [
      { label: "Product", value: "Ethanol 96%" },
      { label: "Warehouse", value: "Main Warehouse" },
      { label: "Qty", value: "48 drums" },
      { label: "Expiry", value: "21 Oct 2026" },
      { label: "QC", value: "Pass — shelf-life watch" },
      { label: "Notes", value: "Prioritise for near-term deliveries." },
    ],
    summary: [
      { label: "On hand", value: "48" },
      { label: "Days left", value: "42" },
      { label: "Status", value: "Watch" },
      { label: "Age", value: "1d" },
    ],
    history: [{ id: "bh3", at: THIS_WEEK, label: "Flagged", detail: "Expiry watch list" }],
  },
  {
    id: "batch-old",
    module: "Batches",
    primary: "ETH-26002",
    secondary: "Q1 solvent campaign residual",
    status: "Consumed",
    tone: "info",
    date: THIS_YEAR,
    searchText: "ETH-26002 Consumed solvent",
    fields: [
      { label: "Product", value: "Ethanol 96%" },
      { label: "Warehouse", value: "Main Warehouse" },
      { label: "Original qty", value: "30 drums" },
      { label: "Closed", value: "18 Mar 2026" },
      { label: "Notes", value: "Fully issued against TLB-ORD-2603-00105." },
    ],
    summary: [
      { label: "Issued", value: "30" },
      { label: "Remaining", value: "0" },
      { label: "Status", value: "Consumed" },
      { label: "Age", value: "175d" },
    ],
    history: [{ id: "bh4", at: THIS_YEAR, label: "Closed", detail: "Batch fully consumed" }],
  },
  // Stock Movements
  {
    id: "mv-tr",
    module: "Stock Movements",
    primary: "TR-26088",
    secondary: "Main Warehouse → Factory Store · 40 drums",
    status: "Posted",
    tone: "success",
    date: TODAY,
    searchText: "TR-26088 transfer HCl Factory Posted",
    fields: [
      { label: "Type", value: "Transfer" },
      { label: "Product", value: "Hydrochloric Acid 32%" },
      { label: "From", value: "Main Warehouse" },
      { label: "To", value: "Factory Store" },
      { label: "Qty", value: "40 drums" },
      { label: "Posted by", value: "Warehouse" },
      { label: "Notes", value: "WIP feed for dilution run." },
    ],
    summary: [
      { label: "Qty", value: "40" },
      { label: "Type", value: "Transfer" },
      { label: "Status", value: "Posted" },
      { label: "When", value: "Today" },
    ],
    history: [{ id: "mh1", at: TODAY, label: "Posted", detail: "Transfer confirmed" }],
  },
  {
    id: "mv-gr",
    module: "Stock Movements",
    primary: "GR-26061",
    secondary: "IMP-26017 receipt · NaOH",
    status: "Draft",
    tone: "warning",
    date: THIS_WEEK,
    searchText: "GR-26061 goods receipt NaOH Draft import",
    fields: [
      { label: "Type", value: "Goods receipt" },
      { label: "Linked import", value: "IMP-26017" },
      { label: "Product", value: "Sodium Hydroxide" },
      { label: "Warehouse", value: "Main Warehouse" },
      { label: "Qty", value: "Pending count" },
      { label: "Notes", value: "Awaiting bonded release paperwork." },
    ],
    summary: [
      { label: "Type", value: "GRN" },
      { label: "Status", value: "Draft" },
      { label: "Import", value: "IMP-26017" },
      { label: "When", value: "This week" },
    ],
    history: [{ id: "mh2", at: THIS_WEEK, label: "Drafted", detail: "Created from import clearing" }],
  },
  {
    id: "mv-issue",
    module: "Stock Movements",
    primary: "IS-26019",
    secondary: "Sales issue · Ethanol to Apex",
    status: "Posted",
    tone: "success",
    date: THIS_QUARTER,
    searchText: "IS-26019 issue Ethanol Apex Posted",
    fields: [
      { label: "Type", value: "Issue" },
      { label: "Product", value: "Ethanol 96%" },
      { label: "Order", value: "TLB-ORD-2608-00104" },
      { label: "Qty", value: "20 drums" },
      { label: "Warehouse", value: "Main Warehouse" },
    ],
    summary: [
      { label: "Qty", value: "20" },
      { label: "Type", value: "Issue" },
      { label: "Status", value: "Posted" },
      { label: "When", value: "Aug" },
    ],
    history: [{ id: "mh3", at: THIS_QUARTER, label: "Posted", detail: "Linked to partial supply" }],
  },
  // Procurement
  {
    id: "po-ningbo",
    module: "Procurement",
    primary: "PO-26017",
    secondary: "Ningbo Industrial Chem · 1 container",
    status: "In transit",
    tone: "info",
    date: TODAY,
    searchText: "PO-26017 Ningbo Industrial Chem In transit sodium",
    fields: [
      { label: "Supplier", value: "Ningbo Industrial Chem" },
      { label: "Order date", value: "09 Sep 2026" },
      { label: "Expected", value: "20 Sep 2026" },
      { label: "Value", value: money(186000) },
      { label: "Incoterms", value: "CIF Tema" },
      { label: "Notes", value: "Sodium hydroxide flakes · 40ft container." },
    ],
    summary: [
      { label: "Value", value: money(186000) },
      { label: "Status", value: "In transit" },
      { label: "ETA", value: "20 Sep" },
      { label: "Age", value: "0d" },
    ],
    history: [{ id: "ph1", at: TODAY, label: "Shipped", detail: "Vessel departed Ningbo" }],
  },
  {
    id: "po-drums",
    module: "Procurement",
    primary: "PO-26012",
    secondary: "Tema Drum Works · 200 drums",
    status: "Open",
    tone: "warning",
    date: THIS_WEEK,
    searchText: "PO-26012 Tema Drum Works Open HDPE",
    fields: [
      { label: "Supplier", value: "Tema Drum Works" },
      { label: "Order date", value: "08 Sep 2026" },
      { label: "Expected", value: "12 Sep 2026" },
      { label: "Value", value: money(42000) },
      { label: "Notes", value: "200 HDPE drums for HCl packing." },
    ],
    summary: [
      { label: "Value", value: money(42000) },
      { label: "Status", value: "Open" },
      { label: "ETA", value: "12 Sep" },
      { label: "Age", value: "1d" },
    ],
    history: [{ id: "ph2", at: THIS_WEEK, label: "Opened", detail: "PO confirmed with supplier" }],
  },
  {
    id: "po-prev",
    module: "Procurement",
    primary: "PO-26005",
    secondary: "Tema Drum Works · IBC cages",
    status: "Received",
    tone: "success",
    date: PREV_MONTH,
    searchText: "PO-26005 Tema Drum Received IBC",
    fields: [
      { label: "Supplier", value: "Tema Drum Works" },
      { label: "Order date", value: "28 Aug 2026" },
      { label: "Received", value: "28 Aug 2026" },
      { label: "Value", value: money(27500) },
      { label: "Notes", value: "Closed after full GRN." },
    ],
    summary: [
      { label: "Value", value: money(27500) },
      { label: "Status", value: "Received" },
      { label: "GRN", value: "Complete" },
      { label: "Age", value: "12d" },
    ],
    history: [{ id: "ph3", at: PREV_MONTH, label: "Received", detail: "Full quantity booked" }],
  },
  // Import & Export
  {
    id: "imp-17",
    module: "Import & Export",
    primary: "IMP-26017",
    secondary: "Ningbo → Tema · Sodium Hydroxide",
    status: "Clearing",
    tone: "warning",
    date: TODAY,
    searchText: "IMP-26017 Ningbo Tema Sodium Hydroxide Clearing",
    fields: [
      { label: "Lane", value: "Ningbo → Tema" },
      { label: "Commodity", value: "Sodium Hydroxide" },
      { label: "Linked PO", value: "PO-26017" },
      { label: "Broker", value: "Tema Freight Partners" },
      { label: "Notes", value: "Customs docs under review." },
    ],
    summary: [
      { label: "Status", value: "Clearing" },
      { label: "Mode", value: "Sea" },
      { label: "PO", value: "PO-26017" },
      { label: "When", value: "Today" },
    ],
    history: [{ id: "ih1", at: TODAY, label: "Clearing", detail: "Submitted to Customs" }],
  },
  {
    id: "exp-04",
    module: "Import & Export",
    primary: "EXP-26004",
    secondary: "Tema → Abidjan · Ethanol",
    status: "Booked",
    tone: "info",
    date: THIS_WEEK,
    searchText: "EXP-26004 Abidjan Ethanol Booked export",
    fields: [
      { label: "Lane", value: "Tema → Abidjan" },
      { label: "Commodity", value: "Ethanol 96%" },
      { label: "Qty", value: "20 drums" },
      { label: "Carrier", value: "West Africa Coastal Line" },
      { label: "Notes", value: "Export booking confirmed; stuffing pending." },
    ],
    summary: [
      { label: "Status", value: "Booked" },
      { label: "Mode", value: "Sea" },
      { label: "Qty", value: "20" },
      { label: "When", value: "This week" },
    ],
    history: [{ id: "ih2", at: THIS_WEEK, label: "Booked", detail: "Sailing slot reserved" }],
  },
  {
    id: "imp-old",
    module: "Import & Export",
    primary: "IMP-26002",
    secondary: "Ningbo → Tema · Chemical B",
    status: "Landed",
    tone: "success",
    date: THIS_QUARTER,
    searchText: "IMP-26002 Chemical B Landed",
    fields: [
      { label: "Lane", value: "Ningbo → Tema" },
      { label: "Commodity", value: "Chemical B" },
      { label: "Landed", value: "14 Aug 2026" },
      { label: "Notes", value: "Fully cleared and received into Main Warehouse." },
    ],
    summary: [
      { label: "Status", value: "Landed" },
      { label: "Mode", value: "Sea" },
      { label: "When", value: "Aug" },
      { label: "Age", value: "26d" },
    ],
    history: [{ id: "ih3", at: THIS_QUARTER, label: "Landed", detail: "Bonded release complete" }],
  },
  // Factory
  {
    id: "fac-hp",
    module: "Factory",
    primary: "PO-26042",
    secondary: "Hydrogen Peroxide · Batch HP-26009",
    status: "Mixing 46%",
    tone: "info",
    date: TODAY,
    searchText: "PO-26042 Hydrogen Peroxide Mixing Factory",
    fields: [
      { label: "Product", value: "Hydrogen Peroxide" },
      { label: "Batch", value: "HP-26009" },
      { label: "Progress", value: "46% mixing" },
      { label: "Line", value: "Reactor 2" },
      { label: "Supervisor", value: "Factory lead" },
      { label: "Notes", value: "Assay pending after mix complete." },
    ],
    summary: [
      { label: "Progress", value: "46%" },
      { label: "Batch", value: "HP-26009" },
      { label: "Status", value: "Mixing" },
      { label: "When", value: "Today" },
    ],
    history: [{ id: "fh1", at: TODAY, label: "Started", detail: "Charge completed" }],
  },
  {
    id: "fac-hcl",
    module: "Factory",
    primary: "PO-26039",
    secondary: "HCl dilution · Batch HCL-26022",
    status: "Queued",
    tone: "warning",
    date: THIS_WEEK,
    searchText: "PO-26039 HCl dilution Queued",
    fields: [
      { label: "Product", value: "Hydrochloric Acid 32%" },
      { label: "Batch", value: "HCL-26022" },
      { label: "Progress", value: "Queued" },
      { label: "Line", value: "Dilution bay" },
      { label: "Notes", value: "Waiting on water treatment clearance." },
    ],
    summary: [
      { label: "Progress", value: "0%" },
      { label: "Batch", value: "HCL-26022" },
      { label: "Status", value: "Queued" },
      { label: "When", value: "This week" },
    ],
    history: [{ id: "fh2", at: THIS_WEEK, label: "Queued", detail: "Scheduled behind peroxide run" }],
  },
  {
    id: "fac-done",
    module: "Factory",
    primary: "PO-26011",
    secondary: "Ethanol repack · Batch ETH-26018",
    status: "Complete",
    tone: "success",
    date: THIS_MONTH,
    searchText: "PO-26011 Ethanol Complete repack",
    fields: [
      { label: "Product", value: "Ethanol 96%" },
      { label: "Batch", value: "ETH-26018" },
      { label: "Completed", value: "02 Sep 2026" },
      { label: "Notes", value: "Repack into sales drums complete." },
    ],
    summary: [
      { label: "Progress", value: "100%" },
      { label: "Batch", value: "ETH-26018" },
      { label: "Status", value: "Complete" },
      { label: "When", value: "This month" },
    ],
    history: [{ id: "fh3", at: THIS_MONTH, label: "Complete", detail: "Released to warehouse" }],
  },
  // Quality Control
  {
    id: "qc-hold",
    module: "Quality Control",
    primary: "HP-26009",
    secondary: "Hydrogen Peroxide · assay pending",
    status: "Hold",
    tone: "warning",
    date: TODAY,
    searchText: "HP-26009 Hydrogen Peroxide Hold assay",
    fields: [
      { label: "Batch", value: "HP-26009" },
      { label: "Product", value: "Hydrogen Peroxide" },
      { label: "Test", value: "Assay + stability" },
      { label: "Lab", value: "TLB QC Lab" },
      { label: "Notes", value: "Do not release to sales until assay clears." },
    ],
    summary: [
      { label: "Status", value: "Hold" },
      { label: "Tests", value: "2 open" },
      { label: "Batch", value: "HP-26009" },
      { label: "When", value: "Today" },
    ],
    history: [{ id: "qh1", at: TODAY, label: "Hold", detail: "Assay queued" }],
  },
  {
    id: "qc-pass",
    module: "Quality Control",
    primary: "HCL-26001",
    secondary: "Released to sales",
    status: "Pass",
    tone: "success",
    date: THIS_MONTH,
    searchText: "HCL-26001 Pass released sales",
    fields: [
      { label: "Batch", value: "HCL-26001" },
      { label: "Product", value: "Hydrochloric Acid 32%" },
      { label: "Result", value: "Pass" },
      { label: "Released", value: "02 Sep 2026" },
      { label: "Notes", value: "Within concentration and impurity limits." },
    ],
    summary: [
      { label: "Status", value: "Pass" },
      { label: "Tests", value: "0 open" },
      { label: "Batch", value: "HCL-26001" },
      { label: "When", value: "This month" },
    ],
    history: [{ id: "qh2", at: THIS_MONTH, label: "Pass", detail: "Released to sales stock" }],
  },
  {
    id: "qc-old",
    module: "Quality Control",
    primary: "ETH-26002",
    secondary: "Historical release · Q1",
    status: "Pass",
    tone: "success",
    date: THIS_YEAR,
    searchText: "ETH-26002 Pass historical",
    fields: [
      { label: "Batch", value: "ETH-26002" },
      { label: "Product", value: "Ethanol 96%" },
      { label: "Result", value: "Pass" },
      { label: "Released", value: "18 Mar 2026" },
    ],
    summary: [
      { label: "Status", value: "Pass" },
      { label: "Tests", value: "Closed" },
      { label: "Batch", value: "ETH-26002" },
      { label: "When", value: "Mar" },
    ],
    history: [{ id: "qh3", at: THIS_YEAR, label: "Pass", detail: "Campaign release" }],
  },
];

export const MODULE_META: Record<
  string,
  { kicker: string; description: string; searchPlaceholder: string; emptyTitle: string; emptyDetail: string }
> = {
  Quotations: {
    kicker: "Business",
    description: "Open commercial quotations awaiting conversion.",
    searchPlaceholder: "Search quote #, customer, product, status…",
    emptyTitle: "No quotations in this period",
    emptyDetail: "Try This Month / This Quarter, or clear search.",
  },
  Batches: {
    kicker: "Inventory",
    description: "Traceable production and import batches.",
    searchPlaceholder: "Search batch, product, warehouse, status…",
    emptyTitle: "No batches in this period",
    emptyDetail: "Widen the period filter to see older batches.",
  },
  "Stock Movements": {
    kicker: "Inventory",
    description: "Recent receipts, issues, and transfers.",
    searchPlaceholder: "Search movement #, product, type, status…",
    emptyTitle: "No movements in this period",
    emptyDetail: "Pick a wider period to include posted history.",
  },
  Procurement: {
    kicker: "Operations",
    description: "Purchase orders awaiting receipt or approval.",
    searchPlaceholder: "Search PO #, supplier, status…",
    emptyTitle: "No purchase orders in this period",
    emptyDetail: "Period filters PO order dates.",
  },
  "Import & Export": {
    kicker: "Operations",
    description: "Shipments currently moving through Tema.",
    searchPlaceholder: "Search shipment #, lane, commodity, status…",
    emptyTitle: "No shipments in this period",
    emptyDetail: "Try This Week or This Month for active lanes.",
  },
  Factory: {
    kicker: "Operations",
    description: "Production orders on the factory floor.",
    searchPlaceholder: "Search production #, product, batch, status…",
    emptyTitle: "No production orders in this period",
    emptyDetail: "Widen the period to include queued or completed runs.",
  },
  "Quality Control": {
    kicker: "Operations",
    description: "Batches waiting laboratory release.",
    searchPlaceholder: "Search batch, product, result, status…",
    emptyTitle: "No QC records in this period",
    emptyDetail: "Period filters QC event dates.",
  },
};

export function recordsForModule(
  module: string,
  range?: DateRange | null,
  opts?: { hideIds?: ReadonlySet<string>; userQuotations?: ReadonlyArray<Parameters<typeof quotationToCatalogRecord>[0]> },
): CatalogRecord[] {
  const source =
    module === "Quotations"
      ? [
          ...(opts?.userQuotations ?? []).map(quotationToCatalogRecord),
          ...QUOTATION_RECORDS,
        ]
      : SANDBOX_RECORDS.filter((r) => r.module === module);
  const hide = opts?.hideIds;
  const visible = hide?.size ? source.filter((r) => !hide.has(r.id)) : source;
  if (!range) return visible;
  return visible.filter((r) => isoInRange(r.date, range));
}

/** Lookup any catalog/sandbox record by id (quotations + ops sandbox modules). */
export function findCatalogRecord(
  id: string,
  userQuotations?: ReadonlyArray<Parameters<typeof quotationToCatalogRecord>[0]>,
): CatalogRecord | undefined {
  const fromUser = userQuotations?.find((q) => q.id === id);
  if (fromUser) return quotationToCatalogRecord(fromUser);
  return QUOTATION_RECORDS.find((r) => r.id === id) ?? SANDBOX_RECORDS.find((r) => r.id === id);
}
