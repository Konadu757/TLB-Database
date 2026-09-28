import type { CompanyProfile, Invoice, InvoiceLine, Receipt, ReceiptLine } from "@/lib/domain/types";
import { formatMoney } from "@/lib/store/tlb-store";

const BRAND_PURPLE = "#523786";
const BRAND_GOLD = "#FFDC7A";

/** Public asset — served from /brand on Vercel and locally. */
export const LETTERHEAD_PUBLIC_PATH = "/brand/tlb-letterhead.svg";

let letterheadDataUrlCache: string | null = null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Save a standalone HTML document the user can open or print later. */
export function downloadHtmlDocument(filename: string, html: string): void {
  const safeName = filename.replace(/[^\w.\-]+/g, "_");
  downloadBlob(safeName.endsWith(".html") ? safeName : `${safeName}.html`, new Blob([html], { type: "text/html;charset=utf-8" }));
}

function absoluteLetterheadUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${LETTERHEAD_PUBLIC_PATH}`;
  }
  return LETTERHEAD_PUBLIC_PATH;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read letterhead"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Resolve letterhead for printable HTML. Prefers an embedded data URL so
 * downloaded files and print windows show branding without relying on relative paths.
 */
export async function resolveLetterheadSrc(): Promise<string> {
  if (letterheadDataUrlCache) return letterheadDataUrlCache;
  const absolute = absoluteLetterheadUrl();
  try {
    const res = await fetch(absolute);
    if (!res.ok) throw new Error(`Letterhead HTTP ${res.status}`);
    const dataUrl = await blobToDataUrl(await res.blob());
    letterheadDataUrlCache = dataUrl;
    return dataUrl;
  } catch {
    return absolute;
  }
}

/**
 * Open a print-ready window. Browser "Save as PDF" is the PDF path
 * (project has no PDF library).
 */
export function printDocumentAsPdf(html: string, documentTitle: string): boolean {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = `${documentTitle} — Save as PDF`;

  const triggerPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      /* ignore blocked print */
    }
  };

  const imgs = Array.from(win.document.images);
  if (imgs.length === 0) {
    window.setTimeout(triggerPrint, 300);
    return true;
  }

  let pending = imgs.length;
  const done = () => {
    pending -= 1;
    if (pending <= 0) window.setTimeout(triggerPrint, 50);
  };
  for (const img of imgs) {
    if (img.complete) done();
    else {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    }
  }
  window.setTimeout(triggerPrint, 4000);
  return true;
}

const DOC_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", system-ui, sans-serif;
    color: #1a1525;
    background: #fff;
    font-size: 13px;
    line-height: 1.45;
  }
  .page {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: #fff;
  }
  .letterhead-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    z-index: 0;
    pointer-events: none;
    user-select: none;
  }
  .doc-body {
    position: relative;
    z-index: 1;
    /* Clear letterhead header (~y 0–90) and footer (~y 772+) on A4 artboard */
    padding: 32mm 16mm 34mm;
    min-height: 297mm;
  }
  .doc-title-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 2px solid ${BRAND_PURPLE};
  }
  .doc-title-row .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: ${BRAND_PURPLE};
    font-weight: 700;
  }
  .doc-title-row strong {
    display: block;
    margin-top: 2px;
    font-size: 1.25rem;
    color: #1a1525;
  }
  .doc-title-row .right { text-align: right; }
  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px 28px;
    margin: 0 0 18px;
  }
  .meta h2, .section-title {
    margin: 0 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: ${BRAND_PURPLE};
  }
  .muted { color: #5c5568; font-size: 12px; margin-top: 2px; }
  dl { margin: 0; display: grid; gap: 6px; }
  dl > div { display: grid; grid-template-columns: 118px 1fr; gap: 8px; }
  dt { color: #6b6575; font-weight: 500; }
  dd { margin: 0; font-weight: 600; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
  }
  th, td {
    padding: 8px 10px;
    border-bottom: 1px solid #e8e4ef;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f3eff8;
    color: ${BRAND_PURPLE};
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .totals {
    margin-top: 16px;
    margin-left: auto;
    width: min(320px, 100%);
    border: 1px solid #e8e4ef;
    border-radius: 6px;
    overflow: hidden;
    background: rgba(255,255,255,0.92);
  }
  .totals .row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 12px;
    border-bottom: 1px solid #eee;
  }
  .totals .row:last-child { border-bottom: 0; }
  .totals .grand {
    background: #f3eff8;
    font-weight: 700;
    color: ${BRAND_PURPLE};
  }
  .status {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: #fff6d6;
    color: ${BRAND_PURPLE};
    border: 1px solid ${BRAND_GOLD};
  }
  .notes { margin-top: 18px; padding-top: 12px; border-top: 1px dashed #ddd; }
  .footer {
    margin-top: 22px;
    font-size: 10px;
    color: #7a7385;
    text-align: center;
  }
  @media print {
    @page { size: A4; margin: 0; }
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; margin: 0; }
    .page { width: 210mm; min-height: 297mm; margin: 0; }
  }
`;

function wrapDocument(opts: {
  title: string;
  docLabel: string;
  docNumber: string;
  company: CompanyProfile;
  partyHtml: string;
  bodyHtml: string;
  letterheadSrc: string;
}): string {
  const { title, docLabel, docNumber, company, partyHtml, bodyHtml, letterheadSrc } = opts;
  const companyLines = [
    `<div><strong>${escapeHtml(company.tradingName || company.legalName)}</strong></div>`,
    company.legalName && company.legalName !== company.tradingName
      ? `<div class="muted">${escapeHtml(company.legalName)}</div>`
      : "",
    company.address ? `<div class="muted">${escapeHtml(company.address)}</div>` : "",
    [company.phone, company.email].filter(Boolean).length
      ? `<div class="muted">${escapeHtml([company.phone, company.email].filter(Boolean).join(" · "))}</div>`
      : "",
    company.tin ? `<div class="muted">TIN: ${escapeHtml(company.tin)}</div>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${DOC_STYLES}</style>
</head>
<body>
  <div class="page">
    <img class="letterhead-bg" src="${escapeHtml(letterheadSrc)}" alt="" />
    <div class="doc-body">
      <header class="doc-title-row">
        <div>
          <div class="label">${escapeHtml(docLabel)}</div>
          <strong>${escapeHtml(docNumber)}</strong>
        </div>
        <div class="right muted">Generated ${escapeHtml(formatDate(new Date().toISOString()))}</div>
      </header>
      <section class="meta">
        <div>
          <h2>From</h2>
          ${companyLines}
        </div>
        ${partyHtml}
      </section>
      ${bodyHtml}
      <p class="footer">TLB Management System</p>
    </div>
  </div>
</body>
</html>`;
}

export type InvoiceDownloadContext = {
  invoice: Invoice;
  lines: InvoiceLine[];
  company: CompanyProfile;
  customerName: string;
  vatRatePercent: number;
  orderNumber?: string;
};

export function buildInvoiceHtml(ctx: InvoiceDownloadContext, letterheadSrc: string): string {
  const { invoice, lines, company, customerName, vatRatePercent, orderNumber } = ctx;
  const balance = Math.max(0, invoice.total - invoice.amountPaid);
  const lineRows =
    lines.length === 0
      ? `<tr><td colspan="6" class="muted">No line items</td></tr>`
      : lines
          .map(
            (l) => `<tr>
        <td>${escapeHtml(l.description)}</td>
        <td class="num">${l.quantity}</td>
        <td class="num">${escapeHtml(formatMoney(l.unitPrice))}</td>
        <td class="num">${escapeHtml(formatMoney(l.lineSubtotal))}</td>
        <td class="num">${escapeHtml(formatMoney(l.vatAmount))}</td>
        <td class="num">${escapeHtml(formatMoney(l.lineTotal))}</td>
      </tr>`,
          )
          .join("");

  const partyHtml = `
      <div>
        <h2>Bill to</h2>
        <div><strong>${escapeHtml(customerName || "—")}</strong></div>
        ${invoice.billingAddress ? `<div class="muted">${escapeHtml(invoice.billingAddress)}</div>` : ""}
        <dl style="margin-top:10px">
          <div><dt>TIN</dt><dd>${escapeHtml(invoice.customerTin || "—")}</dd></div>
          <div><dt>Customer PO #</dt><dd>${escapeHtml(invoice.customerPoNumber || "—")}</dd></div>
          <div><dt>Invoice date</dt><dd>${escapeHtml(formatDate(invoice.invoiceDate))}</dd></div>
          ${orderNumber ? `<div><dt>Order</dt><dd>${escapeHtml(orderNumber)}</dd></div>` : ""}
          <div><dt>Payment</dt><dd><span class="status">${escapeHtml(invoice.paymentStatus)}</span></dd></div>
          <div><dt>Prepared by</dt><dd>${escapeHtml(invoice.preparedBy || "—")}</dd></div>
        </dl>
      </div>`;

  const bodyHtml = `
    <section>
      <h2 class="section-title">Line items</h2>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th class="num">Qty</th>
            <th class="num">Price</th>
            <th class="num">Subtotal</th>
            <th class="num">VAT</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>
      <div class="totals">
        <div class="row"><span>Subtotal</span><span>${escapeHtml(formatMoney(invoice.subtotal))}</span></div>
        <div class="row"><span>VAT (${vatRatePercent}%)</span><span>${escapeHtml(formatMoney(invoice.vatAmount))}</span></div>
        <div class="row grand"><span>Total</span><span>${escapeHtml(formatMoney(invoice.total))}</span></div>
        <div class="row"><span>Amount paid</span><span>${escapeHtml(formatMoney(invoice.amountPaid))}</span></div>
        <div class="row"><span>Balance</span><span>${escapeHtml(formatMoney(balance))}</span></div>
      </div>
      ${
        invoice.notes
          ? `<div class="notes"><strong>Notes</strong><div class="muted">${escapeHtml(invoice.notes)}</div></div>`
          : ""
      }
    </section>`;

  return wrapDocument({
    title: `Invoice ${invoice.number}`,
    docLabel: "VAT Invoice",
    docNumber: invoice.number,
    company,
    partyHtml,
    bodyHtml,
    letterheadSrc,
  });
}

export type ReceiptDownloadContext = {
  receipt: Receipt;
  lines: ReceiptLine[];
  company: CompanyProfile;
  customerName: string;
  invoiceNumber?: string;
  orderNumber?: string;
};

export function buildReceiptHtml(ctx: ReceiptDownloadContext, letterheadSrc: string): string {
  const { receipt, lines, company, customerName, invoiceNumber, orderNumber } = ctx;

  const partyHtml = `
      <div>
        <h2>Received from</h2>
        <div><strong>${escapeHtml(customerName || "—")}</strong></div>
        <dl style="margin-top:10px">
          <div><dt>Receipt date</dt><dd>${escapeHtml(formatDateShort(receipt.receiptDate))}</dd></div>
          <div><dt>Method</dt><dd>${escapeHtml(receipt.paymentMethod)}</dd></div>
          <div><dt>Processed by</dt><dd>${escapeHtml(receipt.processedBy || "—")}</dd></div>
          ${orderNumber ? `<div><dt>Order</dt><dd>${escapeHtml(orderNumber)}</dd></div>` : ""}
          ${invoiceNumber ? `<div><dt>Invoice</dt><dd>${escapeHtml(invoiceNumber)}</dd></div>` : ""}
          <div><dt>Status</dt><dd><span class="status">Paid</span></dd></div>
        </dl>
      </div>`;

  const linesBlock =
    lines.length === 0
      ? ""
      : `
    <section>
      <h2 class="section-title">Line items</h2>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th class="num">Qty</th>
            <th class="num">Price</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lines
            .map(
              (l) => `<tr>
            <td>${escapeHtml(l.description)}</td>
            <td class="num">${l.quantity}</td>
            <td class="num">${escapeHtml(formatMoney(l.unitPrice))}</td>
            <td class="num">${escapeHtml(formatMoney(l.lineTotal))}</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>`;

  const bodyHtml = `
    ${linesBlock}
    <section>
      <div class="totals">
        <div class="row"><span>Amount</span><span>${escapeHtml(formatMoney(receipt.amount))}</span></div>
        <div class="row grand"><span>Amount paid</span><span>${escapeHtml(formatMoney(receipt.amountPaid))}</span></div>
        <div class="row"><span>Balance</span><span>${escapeHtml(formatMoney(receipt.balance))}</span></div>
      </div>
      ${
        receipt.notes
          ? `<div class="notes"><strong>Notes</strong><div class="muted">${escapeHtml(receipt.notes)}</div></div>`
          : ""
      }
    </section>`;

  return wrapDocument({
    title: `Receipt ${receipt.number}`,
    docLabel: "Receipt",
    docNumber: receipt.number,
    company,
    partyHtml,
    bodyHtml,
    letterheadSrc,
  });
}

export async function downloadInvoice(ctx: InvoiceDownloadContext): Promise<void> {
  const letterheadSrc = await resolveLetterheadSrc();
  downloadHtmlDocument(`${ctx.invoice.number}.html`, buildInvoiceHtml(ctx, letterheadSrc));
}

export async function printInvoiceAsPdf(ctx: InvoiceDownloadContext): Promise<boolean> {
  const letterheadSrc = await resolveLetterheadSrc();
  return printDocumentAsPdf(buildInvoiceHtml(ctx, letterheadSrc), ctx.invoice.number);
}

export async function downloadReceipt(ctx: ReceiptDownloadContext): Promise<void> {
  const letterheadSrc = await resolveLetterheadSrc();
  downloadHtmlDocument(`${ctx.receipt.number}.html`, buildReceiptHtml(ctx, letterheadSrc));
}

export async function printReceiptAsPdf(ctx: ReceiptDownloadContext): Promise<boolean> {
  const letterheadSrc = await resolveLetterheadSrc();
  return printDocumentAsPdf(buildReceiptHtml(ctx, letterheadSrc), ctx.receipt.number);
}
