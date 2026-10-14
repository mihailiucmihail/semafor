import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getShop } from "../semafor/shop.server";
import { isOwnerShop } from "../semafor/plan.server";
import { notifyInWork } from "../semafor/in-work.server";

/** orders/updated: owner shops — "order in progress" e-mail when the fulfillment is marked in progress. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  if (!admin || !isOwnerShop(shop)) return new Response();
  const s = await getShop(shop);
  if (!s) return new Response();
  queueMicrotask(async () => {
    try { await notifyInWork(admin as any, s as any, payload); } catch (e) { console.error("[semafor] in-work", e); }
  });
  return new Response();
};
