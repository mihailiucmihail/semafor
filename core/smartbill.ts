/** Pure parts of the SmartBill invoices (app/semafor/smartbill.server.ts): Shopify order → invoice lines → API payload. */
import type { SmartBillSettings } from "./settings.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (x: any) => Number(x?.presentmentMoney?.amount ?? x?.amount ?? 0) || 0;
const COUNTRY = (() => { try { return new Intl.DisplayNames(["ro"], { type: "region" }); } catch { return null; } })();

export type SbLine = { name: string; code?: string; qty: number; price: number; service?: boolean; discount?: number };
export type SbDraft = {
  orderId: string; name: string; createdAt: string; currency: string; taxPct: number; taxesIncluded: boolean;
  client: { name: string; address: string; city: string; county: string; country: string; email: string };
  lines: SbLine[]; total: number; orderTotal: number; ok: boolean; problems: string[];
  status: { financial: string; fulfillment: string; delivered: boolean; cancelled: boolean };
};
export type SbInvoice = { series: string; number: string; at: string; total: number; currency: string; manual?: boolean };


export const ORDER_FIELDS = `id name createdAt cancelledAt taxesIncluded presentmentCurrencyCode displayFinancialStatus displayFulfillmentStatus email
  customAttributes { key value }
  billingAddress { name company address1 address2 city province zip countryCodeV2 }
  shippingAddress { name address1 address2 city province zip countryCodeV2 }
  currentTotalPriceSet { presentmentMoney { amount } }
  taxLines { rate }
  shippingLines(first: 5) { nodes { title originalPriceSet { presentmentMoney { amount } } discountAllocations { allocatedAmountSet { presentmentMoney { amount } } } } }
  lineItems(first: 50) { nodes { name sku quantity currentQuantity originalUnitPriceSet { presentmentMoney { amount } } discountAllocations { allocatedAmountSet { presentmentMoney { amount } } } } }
  smartbill: metafield(namespace: "semafor", key: "smartbill") { value }`;

/** Order → invoice lines. Prices as Shopify shows them (tax included in RO); a line's discounts become a discount line under it. */
export function draftOf(o: any): SbDraft {
  const problems: string[] = [];
  const currency = String(o.presentmentCurrencyCode || "RON");
  const rate = Number((o.taxLines ?? [])[0]?.rate);
  const taxPct = rate > 0 ? r2(rate * 100) : 21;
  const lines: SbLine[] = [];
  for (const li of (o.lineItems?.nodes ?? []) as any[]) {
    const qty = Number(li.currentQuantity ?? li.quantity) || 0;
    const price = num(li.originalUnitPriceSet);
    if (qty <= 0 || price <= 0) continue; // removed / returned items, free gift boxes
    const allocated = ((li.discountAllocations ?? []) as any[]).reduce((s, d) => s + num(d.allocatedAmountSet), 0);
    const disc = r2(allocated * (qty / (Number(li.quantity) || qty)));
    lines.push({ name: String(li.name || "Produs"), code: li.sku || undefined, qty, price: r2(price), discount: disc > 0 ? disc : undefined });
  }
  let ship = 0;
  for (const sl of (o.shippingLines?.nodes ?? []) as any[]) {
    ship += num(sl.originalPriceSet) - ((sl.discountAllocations ?? []) as any[]).reduce((s, d) => s + num(d.allocatedAmountSet), 0);
  }
  ship = r2(ship);
  if (ship > 0) lines.push({ name: "Transport", qty: 1, price: ship, service: true });
  const total = r2(lines.reduce((s, l) => s + l.qty * l.price - (l.discount || 0), 0));
  const orderTotal = r2(num(o.currentTotalPriceSet));
  if (!lines.length) problems.push("нет позиций для фактуры");
  if (o.taxesIncluded === false) problems.push("цены в заказе без НДС — проверь вручную");
  if (Math.abs(total - orderTotal) > 0.05) problems.push(`сумма фактуры ${total} ≠ сумма заказа ${orderTotal}`);
  const cancelled = !!o.cancelledAt;
  if (cancelled) problems.push("заказ отменён");
  if (/refunded/i.test(o.displayFinancialStatus || "") && !/partially/i.test(o.displayFinancialStatus || "")) problems.push("заказ полностью возвращён");
  const a = o.billingAddress || o.shippingAddress || {};
  const cc = String(a.countryCodeV2 || "RO");
  const client = {
    name: String(a.company || a.name || o.email || "Client").trim(),
    address: [a.address1, a.address2].filter(Boolean).join(", "),
    city: String(a.city || ""), county: String(a.province || ""),
    country: cc === "RO" ? "Romania" : (COUNTRY?.of(cc) as string) || cc,
    email: String(o.email || ""),
  };
  const fc = ((o.customAttributes ?? []) as any[]).find((x) => x?.key === "FanCourier status")?.value || "";
  const delivered = /livrat/i.test(fc) && !/nelivrat|retur/i.test(fc);
  return {
    orderId: o.id, name: o.name, createdAt: o.createdAt, currency, taxPct, taxesIncluded: o.taxesIncluded !== false, client, lines, total, orderTotal,
    ok: problems.length === 0, problems,
    status: { financial: String(o.displayFinancialStatus || ""), fulfillment: String(o.displayFulfillmentStatus || ""), delivered, cancelled },
  };
}

export const invoiceOf = (o: any): SbInvoice | null => { try { const v = JSON.parse(o?.smartbill?.value || "null"); return v?.number ? v : null; } catch { return null; } };

export function payloadOf(d: SbDraft, s: SmartBillSettings, taxName: string, issueDate: string) {
  const tax = { taxName, taxPercentage: d.taxPct, isTaxIncluded: d.taxesIncluded };
  const products: any[] = [];
  for (const l of d.lines) {
    products.push({ name: l.name, ...(l.code ? { code: l.code } : {}), isDiscount: false, measuringUnitName: "buc", currency: d.currency, quantity: l.qty, price: l.price, ...tax, isService: !!l.service, saveToDb: false });
    if (l.discount) products.push({ name: `Discount ${l.name}`, isDiscount: true, numberOfItems: 1, discountType: 1, discountValue: -l.discount, measuringUnitName: "buc", currency: d.currency, ...tax });
  }
  return {
    companyVatCode: s.cif,
    client: { name: d.client.name, address: d.client.address, city: d.client.city, county: d.client.county, country: d.client.country, email: d.client.email, isTaxPayer: false, saveToDb: false },
    issueDate, seriesName: s.series, isDraft: false, currency: d.currency, language: "RO", precision: 2, useStock: false,
    mentions: `Comanda ${d.name}`,
    products,
  };
}

