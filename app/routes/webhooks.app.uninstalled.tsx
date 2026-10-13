import type { ActionFunctionArgs } from "@remix-run/node";
import { sessionStorage } from "../shopify.server";
import { verifyWebhook } from "../semafor/webhook-verify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await verifyWebhook(request);
  console.log(`[semafor] ${topic} ${shop}`);
  try {
    // this deployment's own session table (the public app keeps its sessions apart from the private one)
    const sessions = await sessionStorage.findSessionsByShop(shop);
    if (sessions.length) await sessionStorage.deleteSessions(sessions.map((s: any) => s.id));
    await db.shop.updateMany({ where: { domain: shop }, data: { uninstalledAt: new Date() } });
  } catch (e) {
    console.error(`[semafor] ${topic} ${shop} failed`, e);
  }
  return new Response();
};
