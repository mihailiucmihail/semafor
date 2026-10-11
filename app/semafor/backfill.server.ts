import db from "../db.server";
import { checkOrder, type AdminClient } from "./check-order.server";
import { SECRET } from "./shop.server";
import type { ShopSettings } from "../../core/settings";

const Q = `#graphql
query($n:Int!){ orders(first:$n, sortKey:CREATED_AT, reverse:true){ nodes{
  id name email phone displayFinancialStatus customAttributes{ key value }
  customer{ id firstName lastName defaultEmailAddress{ emailAddress } defaultPhoneNumber{ phoneNumber } }
  shippingAddress{ firstName lastName name phone address1 address2 city zip countryCodeV2 }
  billingAddress{ firstName lastName name phone address1 address2 city zip countryCodeV2 }
} } }`;

const QRECENT = Q.replace("query($n:Int!){ orders(first:$n,", "query($n:Int!,$q:String!){ orders(first:$n, query:$q,");

const addr = (a: any) => a ? { first_name: a.firstName, last_name: a.lastName, name: a.name, phone: a.phone, address1: a.address1, address2: a.address2, city: a.city, zip: a.zip, country_code: a.countryCodeV2 } : null;

const Q1 = `#graphql
query($id:ID!){ order(id:$id){
  id name email phone displayFinancialStatus customAttributes{ key value }
  customer{ id firstName lastName defaultEmailAddress{ emailAddress } defaultPhoneNumber{ phoneNumber } }
  shippingAddress{ firstName lastName name phone address1 address2 city zip countryCodeV2 }
  billingAddress{ firstName lastName name phone address1 address2 city zip countryCodeV2 }
} }`;

/** One order from the Admin API, in webhook (REST) shape. */
export async function fetchOrder(admin: AdminClient, id: string) {
  const j: any = await (await admin.graphql(Q1, { variables: { id } })).json();
  if (!j?.data?.order) throw new Error(j?.errors?.map((e: any) => e.message).join("; ") || "order not found");
  return toOrderLike(j.data.order);
}

/** Map an Admin GraphQL order to the webhook (REST) shape checkOrder expects. */
export function toOrderLike(o: any) {
  return {
    admin_graphql_api_id: o.id, name: o.name, email: o.email, phone: o.phone, financial_status: o.displayFinancialStatus?.toLowerCase(),
    customer: o.customer ? { id: o.customer.id, first_name: o.customer.firstName, last_name: o.customer.lastName, email: o.customer.defaultEmailAddress?.emailAddress, phone: o.customer.defaultPhoneNumber?.phoneNumber } : null,
    shipping_address: addr(o.shippingAddress), billing_address: addr(o.billingAddress),
    note_attributes: (o.customAttributes || []).map((x: any) => ({ name: x.key, value: x.value })),
  };
}

/** Check the last N orders (never auto-cancels — those orders may already be shipped). */
export async function backfill(admin: AdminClient, shop: { id: string; domain: string; country: string; settings: ShopSettings }, n = 50) {
  const r = await admin.graphql(Q, { variables: { n } });
  const j: any = await r.json();
  if (j.errors) throw new Error(j.errors.map((e: any) => e.message).join("; "));
  const orders = j.data.orders.nodes as any[];
  const out = { checked: 0, red: 0, yellow: 0, failed: 0, noCustomerData: 0 };
  for (const o of orders) {
    if (!o.email && !o.phone && !o.shippingAddress && !o.customer) out.noCustomerData++;
    try {
      const res = await checkOrder({ db, secret: SECRET, shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, order: toOrderLike(o), admin, skipCancel: true });
      out.checked++;
      if (res.combined === "red") out.red++; else if (res.combined === "yellow") out.yellow++;
    } catch (e) { out.failed++; console.error("[semafor] backfill", o.name, e); }
  }
  console.log(`[semafor] backfill ${shop.domain}`, out);
  return out;
}

const lastCatchUp = new Map<string, number>();
/**
 * Safety net for lost orders/create webhooks: checks the newest orders that have no verdict yet.
 * Called when the admin opens the dashboard (throttled to once per 30 s per shop) and from orders/* webhooks.
 */
export async function catchUpOrders(admin: AdminClient, shop: { id: string; domain: string; country: string; settings: ShopSettings }, n = 10) {
  const last = lastCatchUp.get(shop.id) || 0;
  if (Date.now() - last < 30_000) return 0;
  lastCatchUp.set(shop.id, Date.now());
  // only recent orders (last 48 h): never re-tag a store's old history
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const r = await admin.graphql(QRECENT, { variables: { n, q: `created_at:>='${since}'` } });
  const j: any = await r.json();
  if (j.errors) throw new Error(j.errors.map((e: any) => e.message).join("; "));
  const orders = (j.data?.orders?.nodes ?? []) as any[];
  if (!orders.length) return 0;
  const done = await db.orderCheck.findMany({ where: { shopId: shop.id, orderId: { in: orders.map((o) => o.id) } }, select: { orderId: true } });
  const seen = new Set(done.map((d: any) => d.orderId));
  let n2 = 0;
  for (const o of orders) {
    if (seen.has(o.id)) continue;
    try {
      await checkOrder({ db, secret: SECRET, shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, order: toOrderLike(o), admin, skipCancel: true });
      n2++;
    } catch (e) { console.error("[semafor] catch-up", o.name, e); }
  }
  if (n2) console.log(`[semafor] catch-up ${shop.domain}: checked ${n2} order(s) the webhook missed`);
  return n2;
}
