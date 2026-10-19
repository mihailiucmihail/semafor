// Records that the overview page asked Shopify for the review modal (and Shopify's answer code).
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../semafor/shop.server";
import { markReviewAsked } from "../semafor/review.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const fd = await request.formData();
  const code = String(fd.get("code") || "unknown").slice(0, 40);
  await markReviewAsked(shop.id, code);
  return { ok: true };
};
