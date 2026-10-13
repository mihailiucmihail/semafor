import crypto from "node:crypto";

/**
 * HMAC-only webhook check for topics that arrive after the app is gone (app/uninstalled, shop/redact,
 * customers/*, app_subscriptions/update). authenticate.webhook() also loads the offline session and, with
 * expiring offline tokens, tries to refresh an expired one — for an uninstalled shop that refresh fails and
 * the webhook answered 500 (Shopify kept retrying it every hour). These topics never need the Admin API.
 */
export async function verifyWebhook(request: Request) {
  if (request.method !== "POST") throw new Response(undefined, { status: 405 });
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256") || "";
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  const a = Buffer.from(digest), b = Buffer.from(hmac);
  if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Response(undefined, { status: 401 });
  const shop = String(request.headers.get("x-shopify-shop-domain") || "");
  // same shape authenticate.webhook gives: "APP_UNINSTALLED", "SHOP_REDACT", …
  const topic = String(request.headers.get("x-shopify-topic") || "").toUpperCase().replace(/[/.]/g, "_");
  let payload: any = {};
  try { payload = JSON.parse(raw || "{}"); } catch { /* keep {} */ }
  return { shop, topic, payload };
}
