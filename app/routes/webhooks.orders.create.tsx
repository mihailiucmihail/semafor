import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShop, SECRET } from "../semafor/shop.server";
import { checkOrder } from "../semafor/check-order.server";
import { fetchOrder } from "../semafor/backfill.server";
import { withinQuota } from "../semafor/plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin, topic } = await authenticate.webhook(request);
  console.log(`[semafor] ${topic} ${shop} ${(payload as any)?.name}`);
  if (!admin) return new Response();
  const s = await getShop(shop);
  if (!s) return new Response();

  // Respond fast; do the work after the response is sent.
  queueMicrotask(async () => {
    try {
      if (!(await withinQuota(s))) { console.log(`[semafor] ${shop}: free plan monthly limit reached, order not checked`); return; }
      const res = await checkOrder({ db, secret: SECRET, shopId: s.id, shopDomain: shop, country: s.country, settings: s.settings, order: payload, admin });
      for (const id of res.related) {
        const o = await fetchOrder(admin as any, id);
        await checkOrder({ db, secret: SECRET, shopId: s.id, shopDomain: shop, country: s.country, settings: s.settings, order: o, admin, skipCancel: true });
      }
    } catch (e) {
      console.error("[semafor] checkOrder failed", e);
    }
  });
  return new Response();
};
