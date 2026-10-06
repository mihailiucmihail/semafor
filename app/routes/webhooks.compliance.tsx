import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR webhooks required by the App Store.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const s = await db.shop.findUnique({ where: { domain: shop } });
  console.log(`[semafor] compliance ${topic} ${shop}`);
  if (!s) return new Response();

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // We hold only what the merchant typed; log the request for manual answer within 30 days.
      await db.auditLog.create({ data: { shopId: s.id, actor: "shopify", action: "gdpr.data_request", payload: payload as any } });
      break;
    }
    case "CUSTOMERS_REDACT": {
      const p = payload as any;
      const email = p?.customer?.email as string | undefined;
      const phone = p?.customer?.phone as string | undefined;
      // Remove raw values; keep hashes (anonymised) so the block itself survives, as stated in the policy.
      const where = { shopId: s.id, OR: [email ? { kind: "email" as const, raw: { equals: email, mode: "insensitive" as const } } : undefined, phone ? { kind: "phone" as const, raw: phone } : undefined].filter(Boolean) as any };
      if (where.OR.length) await db.identifier.updateMany({ where, data: { raw: "[redacted]" } });
      await db.auditLog.create({ data: { shopId: s.id, actor: "shopify", action: "gdpr.customer_redact", payload: { hadEmail: !!email, hadPhone: !!phone } } });
      break;
    }
    case "SHOP_REDACT": {
      await db.shop.delete({ where: { id: s.id } }); // cascades entries, identifiers, checks, audit
      break;
    }
  }
  return new Response();
};
