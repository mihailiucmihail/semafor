import type { ActionFunctionArgs } from "@remix-run/node";
import { verifyWebhook } from "../semafor/webhook-verify.server";
import { SECRET } from "../semafor/shop.server";
import { redactCustomer } from "../../core/redact";
import { shopRef } from "../../core/hash";
import db from "../db.server";

// GDPR webhooks required by the App Store.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await verifyWebhook(request);
  console.log(`[semafor] compliance ${topic} ${shop}`);

  if (topic === "SHOP_REDACT") {
    // sent by Shopify 48 h after uninstall: everything of the shop goes, also what has no foreign key to it —
    // its reports in the network (by its irreversible shopRef) and its unsubscribe list (per shop, useless once
    // the shop is gone: a reinstall is a new shop row).
    const s = await db.shop.findUnique({ where: { domain: shop }, select: { id: true } });
    await db.networkReport.deleteMany({ where: { shopRef: shopRef(SECRET, shop) } });
    if (s) {
      await db.emailOptOut.deleteMany({ where: { shopId: s.id } });
      await db.shop.deleteMany({ where: { id: s.id } }); // cascades entries, identifiers, checks, attempts, e-mails, pop-up leads, audit
    }
    return new Response();
  }

  const s = await db.shop.findUnique({ where: { domain: shop }, select: { id: true, domain: true, country: true } });
  if (!s) return new Response();

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // answered by hand within 30 days; the request (with the buyer's e-mail / phone) is kept in the activity log,
      // which is deleted after 12 months (core/retention.ts) or with the shop.
      await db.auditLog.create({ data: { shopId: s.id, actor: "shopify", action: "gdpr.data_request", payload: payload as any } });
      break;
    }
    case "CUSTOMERS_REDACT": {
      const p = payload as any;
      const counts = await redactCustomer(db, SECRET, s, {
        email: p?.customer?.email ?? null,
        phone: p?.customer?.phone ?? null,
        orderIds: Array.isArray(p?.orders_to_redact) ? p.orders_to_redact : [],
      });
      await db.auditLog.create({ data: { shopId: s.id, actor: "shopify", action: "gdpr.customer_redact", payload: counts as any } });
      // the buyer's hashes leave the checkout blocklist too (if this deployment holds the shop's session)
      if (counts.entries) {
        try {
          const { unauthenticated } = await import("../shopify.server");
          const { pushCheckoutMetafield } = await import("../semafor/entries.server");
          const { admin } = await unauthenticated.admin(s.domain);
          await pushCheckoutMetafield(admin as any, s.id);
        } catch (e: any) { console.error("[semafor] redact: blocklist push", s.domain, e?.message || e); }
      }
      break;
    }
  }
  return new Response();
};
