import db from "../db.server";
import { checkOrder, type AdminClient } from "./check-order.server";
import { SECRET } from "./shop.server";
import type { ShopSettings } from "../../core/settings";

const Q = `#graphql
query($n:Int!){ orders(first:$n, sortKey:CREATED_AT, reverse:true){ nodes{
  id name email phone customAttributes{ key value }
  customer{ firstName lastName defaultEmailAddress{ emailAddress } defaultPhoneNumber{ phoneNumber } }
  shippingAddress{ firstName lastName name phone address1 address2 city zip countryCodeV2 }
  billingAddress{ firstName lastName name phone address1 address2 city zip countryCodeV2 }
} } }`;

const addr = (a: any) => a ? { first_name: a.firstName, last_name: a.lastName, name: a.name, phone: a.phone, address1: a.address1, address2: a.address2, city: a.city, zip: a.zip, country_code: a.countryCodeV2 } : null;

/** Map an Admin GraphQL order to the webhook (REST) shape checkOrder expects. */
export function toOrderLike(o: any) {
  return {
    admin_graphql_api_id: o.id, name: o.name, email: o.email, phone: o.phone,
    customer: o.customer ? { first_name: o.customer.firstName, last_name: o.customer.lastName, email: o.customer.defaultEmailAddress?.emailAddress, phone: o.customer.defaultPhoneNumber?.phoneNumber } : null,
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
