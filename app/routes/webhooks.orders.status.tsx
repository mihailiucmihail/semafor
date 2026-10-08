import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShop, SECRET } from "../semafor/shop.server";
import { checkOrder } from "../semafor/check-order.server";
import { fetchOrder } from "../semafor/backfill.server";

/**
 * orders/paid, orders/cancelled, orders/fulfilled: something changed on one order of a customer.
 * Re-check this customer's other open orders that were yellow because of other orders.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin, topic } = await authenticate.webhook(request);
  if (!admin) return new Response();
  const s = await getShop(shop);
  if (!s) return new Response();
  const p: any = payload;
  queueMicrotask(async () => {
    try {
      const cid = p?.customer?.id; const email = p?.email;
      if (!cid && !email) return;
      const r: any = await (await (admin as any).graphql(`#graphql
        query($q:String!){ orders(first:10, query:$q, sortKey:CREATED_AT, reverse:true){ nodes{ id } } }`,
        { variables: { q: `${cid ? `customer_id:${cid}` : `email:"${email}"`} -status:cancelled` } })).json();
      for (const o of r?.data?.orders?.nodes ?? []) {
        if (o.id === p.admin_graphql_api_id) continue;
        const c: any = await db.orderCheck.findUnique({ where: { shopId_orderId: { shopId: s.id, orderId: o.id } } });
        if (!c || !((c.matched as any[]) || []).some((m: any) => m.kind === "order")) continue;
        const order = await fetchOrder(admin as any, o.id);
        await checkOrder({ db, secret: SECRET, shopId: s.id, shopDomain: shop, country: s.country, settings: s.settings, order, admin: admin as any, skipCancel: true });
        console.log(`[semafor] ${topic}: re-checked ${o.id}`);
      }
    } catch (e) { console.error("[semafor] orders status recheck", e); }
  });
  return new Response();
};
