import type { ActionFunctionArgs } from "@remix-run/node";
import { verifyWebhook } from "../semafor/webhook-verify.server";
import db from "../db.server";
import { planFromSubscriptionName } from "../../core/plans";
import { isOwnerShop, applyPlanChange } from "../semafor/plan.server";

/** app_subscriptions/update: the merchant picked, changed or cancelled a plan (managed pricing). */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await verifyWebhook(request);
  const s: any = (payload as any)?.app_subscription ?? {};
  const plan = isOwnerShop(shop) ? "pro" : s.status === "ACTIVE" ? planFromSubscriptionName(s.name) : "free";
  console.log(`[semafor] ${topic} ${shop}: ${s.name} ${s.status} → ${plan}`);
  await db.shop.updateMany({ where: { domain: shop }, data: { plan } });
  // features of the new plan switch on (or off) at checkout and on the storefront right away
  applyPlanChange(shop).catch(() => {});
  return new Response();
};
