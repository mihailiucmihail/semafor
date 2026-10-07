import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop, SECRET } from "../semafor/shop.server";
import { checkOrder } from "../semafor/check-order.server";
import { fetchOrder } from "../semafor/backfill.server";
import { createEntry, pushCheckoutMetafield } from "../semafor/entries.server";
import { REASONS, type Reason } from "../../core/reasons";

/**
 * Backend for the Semafor block on the order page (admin UI extension).
 * GET  ?orderId=gid://shopify/Order/…  → traffic light for this order (checks it now if never checked)
 * POST {orderId, reason, note}          → add the order's customer to the blacklist, re-check the order
 */
async function status(admin: any, shop: any, orderId: string, recheck = false) {
  let c: any = recheck ? null : await db.orderCheck.findUnique({ where: { shopId_orderId: { shopId: shop.id, orderId } } });
  if (!c) {
    const order = await fetchOrder(admin, orderId);
    await checkOrder({ db, secret: SECRET, shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, order, admin, skipCancel: true });
    c = await db.orderCheck.findUnique({ where: { shopId_orderId: { shopId: shop.id, orderId } } });
  }
  const rank = { green: 0, yellow: 1, red: 2 } as const;
  const level = rank[c.networkLevel as keyof typeof rank] > rank[c.level as keyof typeof rank] ? c.networkLevel : c.level;
  const inList = await db.blockEntry.count({ where: { shopId: shop.id, orderId } });
  return { level, score: c.score, networkShops: c.networkShops, matches: c.matched, checkedAt: c.checkedAt, inList: inList > 0 };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, cors } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const orderId = new URL(request.url).searchParams.get("orderId") || "";
  if (!orderId) return cors(Response.json({ error: "orderId lipsă" }, { status: 400 }));
  try { return cors(Response.json(await status(admin, shop, orderId))); }
  catch (e: any) { return cors(Response.json({ error: String(e?.message || e) }, { status: 500 })); }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, cors } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  try {
    const b = await request.json();
    const orderId = String(b.orderId || "");
    const reason: Reason = (REASONS as string[]).includes(b.reason) ? b.reason : "other";
    const o: any = await fetchOrder(admin, orderId);
    const a = o.shipping_address || o.billing_address || {};
    await createEntry({
      shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, actor: (session as any).email || session.shop,
      input: {
        email: o.email || o.customer?.email || undefined, phone: o.phone || a.phone || o.customer?.phone || undefined,
        firstName: a.first_name || o.customer?.first_name || undefined, lastName: a.last_name || o.customer?.last_name || undefined,
        address1: a.address1 || undefined, address2: a.address2 || undefined, city: a.city || undefined,
        reason, note: String(b.note || "").slice(0, 500) || undefined, source: "order", orderId, orderName: o.name,
      },
    });
    await pushCheckoutMetafield(admin, shop.id);
    return cors(Response.json(await status(admin, shop, orderId, true)));
  } catch (e: any) {
    return cors(Response.json({ error: String(e?.message || e) }, { status: 500 }));
  }
};
