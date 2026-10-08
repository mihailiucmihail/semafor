import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { planFromSubscriptionName } from "../../core/plans";
import { isOwnerShop } from "../semafor/plan.server";

/** app_subscriptions/update: the merchant picked, changed or cancelled a plan (managed pricing). */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  const s: any = (payload as any)?.app_subscription ?? {};
  const plan = isOwnerShop(shop) ? "pro" : s.status === "ACTIVE" ? planFromSubscriptionName(s.name) : "free";
  console.log(`[semafor] ${topic} ${shop}: ${s.name} ${s.status} → ${plan}`);
  await db.shop.updateMany({ where: { domain: shop }, data: { plan } });
  return new Response();
};
