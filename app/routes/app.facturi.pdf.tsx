import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { isOwnerShop } from "../semafor/plan.server";
import { ensureShop } from "../semafor/shop.server";
import { invoicePdf, smartbillReady } from "../semafor/smartbill.server";

// Resource route: PDF of an issued SmartBill invoice (owner shop), e.g. /app/facturi/pdf?n=MG3195
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isOwnerShop(session.shop)) throw new Response("Not found", { status: 404 });
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const sb = shop.settings.smartbill;
  const m = /^([A-Za-z]+)-?(\d+)$/.exec(new URL(request.url).searchParams.get("n") || "");
  if (!m || !sb || !smartbillReady(shop.settings)) throw new Response("Bad request", { status: 400 });
  const bytes = await invoicePdf(sb, m[1], m[2]);
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${m[1]}${m[2]}.pdf"` } });
};
