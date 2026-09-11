import type { CompanyProfile, Invoice, InvoiceLine, Receipt, ReceiptLine } from "@/lib/domain/types";
import { formatMoney } from "@/lib/store/tlb-store";

const BRAND_PURPLE = "#523784";
const BRAND_GOLD = "#F9CD5B";

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
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      /* ignore blocked print */
    }
  }, 300);
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
  .page { max-width: 820px; margin: 0 auto; padding: 28px 32px 40px; }
  .brand {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    background: ${BRAND_PURPLE};
    color: #fff;
    border-radius: 6px;
    border-bottom: 4px solid ${BRAND_GOLD};
  }
  .brand-mark {
    width: 42px; height: 42px;
    border-radius: 8px;
    background: ${BRAND_GOLD};
    color: ${BRAND_PURPLE};
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 0.04em;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .brand-left { display: flex; gap: 12px; align-items: center; min-width: 0; }
  .brand h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .brand .tag {
    margin-top: 2px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: ${BRAND_GOLD};
  }
  .brand-doc { text-align: right; }
  .brand-doc .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: ${BRAND_GOLD};
  }
  .brand-doc strong { display: block; margin-top: 2px; font-size: 1.05rem; }
  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px 28px;
    margin: 22px 0 18px;
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
    margin-top: 28px;
    font-size: 11px;
    color: #7a7385;
    text-align: center;
  }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .page { padding: 0; max-width: none; }
  }
`;

function wrapDocument(opts: {
  title: string;
  docLabel: string;
  docNumber: string;
  company: CompanyProfile;
  partyHtml: string;
  bodyHtml: string;
}): string {
  const { title, docLabel, docNumber, company, partyHtml, bodyHtml } = opts;
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
    <header class="brand">
      <div class="brand-left">
        <div class="brand-mark" aria-hidden="true">TLB</div>
        <div>
          <h1>${escapeHtml(company.tradingName || "TLB")}</h1>
          <div class="tag">Management System</div>
        </div>
      </div>
      <div class="brand-doc">
        <div class="label">${escapeHtml(docLabel)}</div>
        <strong>${escapeHtml(docNumber)}</strong>
      </div>
    </header>
    <section class="meta">
      <div>
        <h2>From</h2>
        ${companyLines}
      </div>
      ${partyHtml}
    </section>
    ${bodyHtml}
    <p class="footer">Generated from TLB Management System · ${escapeHtml(formatDate(new Date().toISOString()))}</p>
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

export function buildInvoiceHtml(ctx: InvoiceDownloadContext): string {
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

export function buildReceiptHtml(ctx: ReceiptDownloadContext): string {
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
  });
}

export function downloadInvoice(ctx: InvoiceDownloadContext): void {
  downloadHtmlDocument(`${ctx.invoice.number}.html`, buildInvoiceHtml(ctx));
}

export function printInvoiceAsPdf(ctx: InvoiceDownloadContext): boolean {
  return printDocumentAsPdf(buildInvoiceHtml(ctx), ctx.invoice.number);
}

export function downloadReceipt(ctx: ReceiptDownloadContext): void {
  downloadHtmlDocument(`${ctx.receipt.number}.html`, buildReceiptHtml(ctx));
}

export function printReceiptAsPdf(ctx: ReceiptDownloadContext): boolean {
  return printDocumentAsPdf(buildReceiptHtml(ctx), ctx.receipt.number);
}
