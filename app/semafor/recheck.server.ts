// Yellow lights that depend on OTHER orders ("an order still in transit", "unshipped order — combine") go stale when
// those orders ship or get delivered. Every 15 minutes the recent ones are checked again; a light whose reason is gone
// turns green (tag and Shopify risk updated). Never auto-cancels.
import db from "../db.server";
import { SECRET } from "./shop.server";
import { fetchOrder } from "./backfill.server";
import { checkOrder } from "./check-order.server";
import { healSavedMainCode } from "./popup.server";
import type { ShopSettings } from "../../core/settings";
import { personHashes, toOrderLike as gqlToLike, OPEN_RETURN_REASON, OPEN_RETURN_DAYS } from "./open-cod.server";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };
const DAY = 86_400_000;
const healed = new Set<string>();
const popupHealed = new Set<string>();

export async function recheckTransient(admin: Admin, shop: { id: string; domain: string; country: string; plan?: string | null; settings: ShopSettings }) {
  const rows = (await db.orderCheck.findMany({
    // orders from the last 14 days (by order date; re-checks move checkedAt), not checked in the last 10 minutes
    where: {
      shopId: shop.id, level: { not: "green" }, checkedAt: { lt: new Date(Date.now() - 10 * 60_000) },
      OR: [{ orderedAt: { gt: new Date(Date.now() - 14 * DAY) } }, { orderedAt: null, checkedAt: { gt: new Date(Date.now() - 14 * DAY) } }],
    },
    orderBy: { checkedAt: "asc" }, take: 60, select: { orderId: true, matched: true },
  })) as any[];
  // once per process: green orders whose Shopify risk still shows an older yellow/red Semafor assessment
  // (e.g. the "same device" fact that pointed at the order itself) get Semafor's current, clean assessment
  if (!healed.has(shop.id)) {
    healed.add(shop.id);
    try {
      const r: any = await (await admin.graphql(`#graphql
        query { orders(first: 60, reverse: true, sortKey: CREATED_AT) { nodes { id risk { assessments { riskLevel provider { title } } } } } }`)).json();
      const stale = ((r?.data?.orders?.nodes ?? []) as any[]).filter((o) => { const a = (o.risk?.assessments ?? []).filter((x: any) => /semafor/i.test(x?.provider?.title || "")); return a.length && a[a.length - 1].riskLevel !== "NONE"; }).map((o) => o.id as string);
      const green = stale.length ? ((await db.orderCheck.findMany({ where: { shopId: shop.id, orderId: { in: stale }, level: "green", networkLevel: "green" }, select: { orderId: true } })) as any[]) : [];
      for (const g of green) {
        const order: any = await fetchOrder(admin as any, g.orderId);
        await checkOrder({ db, secret: SECRET, shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, order, admin: admin as any, skipCancel: true, recheck: true });
      }
      if (green.length) console.log("[semafor] healed stale risk", shop.domain, green.length);
    } catch (e: any) { console.error("[semafor] heal risk", shop.domain, e?.message || e); }
  }
  // once per process: a pop-up own code that no longer matches the pop-up (BUNVENIT15 while it gives 10 %) or expired
  if (!popupHealed.has(shop.id)) {
    popupHealed.add(shop.id);
    try { await healSavedMainCode(admin as any, shop); } catch (e: any) { console.error("[semafor] popup heal", shop.domain, e?.message || e); }
  }
  // SmartBill invoices in the order's currency (owner shop, automatic mode on)
  if (shop.settings.smartbill?.auto && shop.settings.smartbill.auto !== "off") {
    try { const { autoInvoices } = await import("./smartbill.server"); const n = await autoInvoices(admin as any, shop); if (n) console.log("[semafor] smartbill auto", shop.domain, n); }
    catch (e: any) { console.error("[semafor] smartbill auto", shop.domain, e?.message || e); }
  }
  try { await flagOpenReturns(admin, shop); } catch (e: any) { console.error("[semafor] open returns", shop.domain, e?.message || e); }
  const transient = rows.filter((r) => ((r.matched as any[]) || []).some((m) => m?.kind === "order" || (m?.kind === "device" && /mai există comenzile|în 48 h de pe același dispozitiv/.test(String(m?.normalized || ""))))).slice(0, 15);
  let n = 0;
  for (const r of transient) {
    try {
      const order: any = await fetchOrder(admin as any, r.orderId);
      await checkOrder({ db, secret: SECRET, shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, order, admin: admin as any, skipCancel: true, recheck: true });
      n++;
    } catch (e: any) {
      console.error("[semafor] recheck", shop.domain, r.orderId, e?.message || e);
    }
  }
  return n;
}

// A return request on one order turns the same person's other recent orders red ("settle the return first — maybe an
// exchange — then ship"). A new order placed AFTER the request is caught by its own first check (personHistory);
// this catches the opposite case: the request comes in after the other order was already placed and checked green.
// Each open return is handled once per process (and again after a restart); the 15-minute re-check of non-green
// orders then drops the red as soon as the return is settled in Shopify.
const seenReturns = new Map<string, Set<string>>();
const QRET = `#graphql
query($q: String!) { orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) { nodes {
  id name createdAt email phone customer { id email phone firstName lastName }
  shippingAddress { firstName lastName name address1 address2 city zip countryCodeV2 phone }
  billingAddress { firstName lastName name address1 address2 city zip countryCodeV2 phone } } } }`;
const QCUST = `#graphql
query($q: String!) { orders(first: 20, query: $q) { nodes { id } } }`;
const QLIVE = `#graphql
query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id cancelledAt createdAt } } }`;

export async function flagOpenReturns(admin: Admin, shop: { id: string; domain: string; country: string; settings: ShopSettings }) {
  const seen = seenReturns.get(shop.id) ?? new Set<string>();
  seenReturns.set(shop.id, seen);
  const since = new Date(Date.now() - OPEN_RETURN_DAYS * DAY).toISOString().slice(0, 10);
  const j: any = await (await admin.graphql(QRET, { variables: { q: `(return_status:return_requested OR return_status:in_progress) created_at:>=${since}` } })).json();
  const returns: any[] = (j?.data?.orders?.nodes ?? []).filter((o: any) => o?.id && !seen.has(o.id));
  const recent = new Date(Date.now() - 30 * DAY);
  let n = 0;
  for (const ret of returns) {
    try {
      // the same person's other orders: same Shopify customer, or same phone / name + address (Semafor's stored hashes)
      const cand = new Set<string>();
      const cid = ret.customer?.id ? String(ret.customer.id).split("/").pop() : null;
      if (cid) {
        const c: any = await (await admin.graphql(QCUST, { variables: { q: `customer_id:${cid} created_at:>=${recent.toISOString().slice(0, 10)}` } })).json();
        for (const o of c?.data?.orders?.nodes ?? []) if (o?.id) cand.add(o.id);
      }
      const ph = personHashes(SECRET, gqlToLike(ret), shop.country);
      if (ph.length) {
        const rows = (await db.orderCheck.findMany({ where: { shopId: shop.id, personHashes: { hasSome: ph }, OR: [{ orderedAt: { gt: recent } }, { orderedAt: null, checkedAt: { gt: recent } }] }, select: { orderId: true }, take: 20 })) as any[];
        for (const r of rows) cand.add(r.orderId);
      }
      cand.delete(ret.id);
      if (cand.size) {
        // only orders Semafor checked, not cancelled, from the last 30 days, not already showing this return
        const checks = (await db.orderCheck.findMany({ where: { shopId: shop.id, orderId: { in: [...cand] } }, select: { orderId: true, matched: true } })) as any[];
        const todo = checks.filter((c) => !((c.matched as any[]) ?? []).some((m) => m?.reason === OPEN_RETURN_REASON && (m.orders ?? []).includes(ret.id)));
        if (todo.length) {
          const live: any = await (await admin.graphql(QLIVE, { variables: { ids: todo.map((c) => c.orderId) } })).json();
          const ok = new Set(((live?.data?.nodes ?? []) as any[]).filter((o) => o?.id && !o.cancelledAt && Date.parse(o.createdAt) > +recent).map((o) => o.id));
          for (const c of todo) {
            if (!ok.has(c.orderId)) continue;
            const order: any = await fetchOrder(admin as any, c.orderId);
            await checkOrder({ db, secret: SECRET, shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, order, admin: admin as any, skipCancel: true, recheck: true, openReturns: [{ id: ret.id, name: ret.name }] });
            n++;
          }
        }
      }
      seen.add(ret.id);
    } catch (e: any) { console.error("[semafor] open return", shop.domain, ret?.name, e?.message || e); }
  }
  if (n) console.log("[semafor] open returns → red", shop.domain, n);
  return n;
}
