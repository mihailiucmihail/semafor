/**
 * SmartBill invoices from Shopify orders, in the ORDER's currency (presentment money: RON for mihailiuc.ro),
 * not the shop currency (EUR since Oct 2026) — the reason this exists: the SmartBill Connector app put the EUR
 * amounts on the invoice labelled as RON.
 *
 * API (ws.smartbill.ro/SBORO/api, Basic auth "username:token"): POST /invoice, GET /tax?cif=…, GET /invoice/pdf.
 * One invoice per order: an AppKv claim `sb:<shop>:<orderId>` is created atomically before the call (two
 * deployments share the database), then holds the result; the order also gets the metafield semafor.smartbill.
 * Owner-only feature (page /app/facturi) — no scopes, extensions or webhooks involved.
 */
import db from "../db.server";
import type { ShopSettings, SmartBillSettings } from "../../core/settings";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };
const API = "https://ws.smartbill.ro/SBORO/api";

import { ORDER_FIELDS, draftOf, invoiceOf, payloadOf, type SbDraft, type SbInvoice } from "../../core/smartbill";
export { ORDER_FIELDS, draftOf, invoiceOf, payloadOf, type SbDraft, type SbInvoice };


function auth(s: SmartBillSettings) {
  return "Basic " + Buffer.from(`${s.username}:${s.token}`).toString("base64");
}
async function call(s: SmartBillSettings, method: string, path: string, body?: any) {
  const res = await fetch(API + path, {
    method,
    headers: { Accept: "application/json", Authorization: auth(s), ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok || j?.errorText) throw new Error(`SmartBill ${res.status}: ${j?.errorText || j?.message || text.slice(0, 300)}`);
  return j;
}

export function smartbillReady(s: ShopSettings) {
  const b = s.smartbill;
  return !!(b?.username && b?.token && b?.cif && b?.series);
}

/** VAT names configured in the SmartBill company (e.g. "Normala" 21 %). */
const taxCache = new Map<string, { at: number; taxes: Array<{ name: string; percentage: number }> }>();
export async function taxes(s: SmartBillSettings) {
  const k = `${s.username}:${s.cif}`;
  const c = taxCache.get(k);
  if (c && Date.now() - c.at < 6 * 3600_000) return c.taxes;
  const j = await call(s, "GET", `/tax?cif=${encodeURIComponent(s.cif)}`);
  const list = ((j?.taxes ?? []) as any[]).map((t) => ({ name: String(t.name), percentage: Number(t.percentage) }));
  taxCache.set(k, { at: Date.now(), taxes: list });
  return list;
}

/** Test the credentials: reads the company's VAT list. */
export async function testConnection(s: SmartBillSettings) {
  taxCache.delete(`${s.username}:${s.cif}`);
  return taxes(s);
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" }); // YYYY-MM-DD
const claimKey = (shopId: string, orderId: string) => `sb:${shopId}:${orderId.split("/").pop()}`;

async function saveMark(admin: Admin, orderId: string, inv: SbInvoice) {
  const r: any = await (await admin.graphql(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`,
    { variables: { m: [{ ownerId: orderId, namespace: "semafor", key: "smartbill", type: "json", value: JSON.stringify(inv) }] } })).json();
  const err = r?.data?.metafieldsSet?.userErrors?.[0]?.message;
  if (err) console.error("[semafor] smartbill metafield", orderId, err);
}

export async function fetchOrderForInvoice(admin: Admin, orderId: string) {
  const r: any = await (await admin.graphql(`query($id:ID!){ order(id:$id){ ${ORDER_FIELDS} } }`, { variables: { id: orderId } })).json();
  return r?.data?.order ?? null;
}

/** Issues the invoice of one order (once). Returns the invoice, or throws with the reason. */
export async function issueInvoice(admin: Admin, shop: { id: string; settings: ShopSettings }, orderId: string, opts: { force?: boolean } = {}): Promise<SbInvoice> {
  const s = shop.settings.smartbill;
  if (!s || !smartbillReady(shop.settings)) throw new Error("SmartBill не настроен");
  const o = await fetchOrderForInvoice(admin, orderId);
  if (!o) throw new Error("заказ не найден");
  const had = invoiceOf(o);
  if (had) throw new Error(`уже есть фактура ${had.series}${had.number}`);
  const d = draftOf(o);
  if (!d.ok && !(opts.force && !d.status.cancelled)) throw new Error(d.problems.join("; "));
  const list = await taxes(s);
  const tax = list.find((t) => Math.abs(t.percentage - d.taxPct) < 0.01);
  if (!tax) throw new Error(`в SmartBill нет ставки НДС ${d.taxPct}%`);
  const key = claimKey(shop.id, orderId);
  const claimed = await db.appKv.create({ data: { key, value: JSON.stringify({ pending: new Date().toISOString() }) } }).then(() => true, () => false);
  if (!claimed) {
    const v = await db.appKv.findUnique({ where: { key } });
    throw new Error(v?.value?.includes("number") ? "фактура уже выписана" : "фактура этого заказа уже выписывается — обнови страницу через минуту");
  }
  let j: any;
  try {
    j = await call(s, "POST", "/invoice", payloadOf(d, s, tax.name, today()));
  } catch (e) {
    await db.appKv.delete({ where: { key } }).catch(() => {});
    throw e;
  }
  const inv: SbInvoice = { series: String(j?.series || s.series), number: String(j?.number || ""), at: new Date().toISOString(), total: d.total, currency: d.currency };
  await db.appKv.update({ where: { key }, data: { value: JSON.stringify(inv) } }).catch(() => {});
  await saveMark(admin, orderId, inv);
  console.log("[semafor] smartbill invoice", o.name, `${inv.series}${inv.number}`, inv.total, inv.currency);
  return inv;
}

/** An invoice issued elsewhere (by hand in SmartBill) — mark the order so it is not issued again. */
export async function markInvoice(admin: Admin, shopId: string, orderId: string, series: string, number: string) {
  const o = await fetchOrderForInvoice(admin, orderId);
  const inv: SbInvoice = { series, number, at: new Date().toISOString(), total: o ? draftOf(o).total : 0, currency: o?.presentmentCurrencyCode || "RON", manual: true };
  await db.appKv.upsert({ where: { key: claimKey(shopId, orderId) }, create: { key: claimKey(shopId, orderId), value: JSON.stringify(inv) }, update: { value: JSON.stringify(inv) } });
  await saveMark(admin, orderId, inv);
  return inv;
}

/** PDF of an issued invoice (bytes). */
export async function invoicePdf(s: SmartBillSettings, series: string, number: string) {
  const res = await fetch(`${API}/invoice/pdf?cif=${encodeURIComponent(s.cif)}&seriesname=${encodeURIComponent(series)}&number=${encodeURIComponent(number)}`, {
    headers: { Accept: "application/octet-stream", Authorization: auth(s) }, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`SmartBill PDF ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Automatic mode (15-min loop): orders created since `autoSince`, without an invoice, with nothing to check by hand,
 * once shipped ("fulfilled") or once FAN Courier says delivered ("delivered").
 */
export async function autoInvoices(admin: Admin, shop: { id: string; domain: string; settings: ShopSettings }) {
  const s = shop.settings.smartbill;
  if (!s || !smartbillReady(shop.settings) || !s.auto || s.auto === "off" || !s.autoSince) return 0;
  const since = new Date(s.autoSince);
  const r: any = await (await admin.graphql(`query($q:String!){ orders(first: 50, reverse: true, sortKey: CREATED_AT, query: $q){ nodes{ ${ORDER_FIELDS} } } }`,
    { variables: { q: `created_at:>='${since.toISOString()}' status:any` } })).json();
  let n = 0;
  for (const o of (r?.data?.orders?.nodes ?? []) as any[]) {
    if (invoiceOf(o) || new Date(o.createdAt) < since) continue;
    if (s.currencies?.length && !s.currencies.includes(o.presentmentCurrencyCode)) continue;
    const d = draftOf(o);
    if (!d.ok) continue;
    const ready = s.auto === "delivered" ? d.status.delivered : /^fulfilled$/i.test(d.status.fulfillment) || d.status.delivered;
    if (!ready) continue;
    try { await issueInvoice(admin, shop, o.id); n++; } catch (e: any) { console.error("[semafor] smartbill auto", shop.domain, o.name, e?.message || e); }
  }
  return n;
}
