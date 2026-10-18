// Yellow lights that depend on OTHER orders ("an order still in transit", "unshipped order — combine") go stale when
// those orders ship or get delivered. Every 15 minutes the recent ones are checked again; a light whose reason is gone
// turns green (tag and Shopify risk updated). Never auto-cancels.
import db from "../db.server";
import { SECRET } from "./shop.server";
import { fetchOrder } from "./backfill.server";
import { checkOrder } from "./check-order.server";
import type { ShopSettings } from "../../core/settings";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };
const DAY = 86_400_000;
const healed = new Set<string>();

export async function recheckTransient(admin: Admin, shop: { id: string; domain: string; country: string; settings: ShopSettings }) {
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
  const transient = rows.filter((r) => ((r.matched as any[]) || []).some((m) => m?.kind === "order")).slice(0, 15);
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
