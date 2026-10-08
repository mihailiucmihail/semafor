import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import db from "../db.server";

/**
 * Receives checkout steps from the Semafor custom pixel (Shopify Customer events).
 * Body is JSON sent as text/plain (no CORS preflight from the pixel sandbox).
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const EVENTS = new Set(["started", "contact", "address", "shipping", "payment", "completed"]);
const hits = new Map<string, { n: number; t: number }>();
const cut = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

export const loader = async (_: LoaderFunctionArgs) => new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;

  // crude rate limit: 120 events / 10 min / IP
  const k = ip || "?"; const now = Date.now(); const h = hits.get(k);
  if (h && now - h.t < 600_000) { if (++h.n > 120) return new Response("slow down", { status: 429, headers: CORS }); } else hits.set(k, { n: 1, t: now });

  let b: any;
  try { b = JSON.parse(await request.text()); } catch { return new Response("bad json", { status: 400, headers: CORS }); }
  const domain = cut(b.shop, 120); const event = cut(b.event, 20); const deviceId = cut(b.deviceId, 64);
  if (!domain || !event || !EVENTS.has(event) || !deviceId) return new Response("missing", { status: 400, headers: CORS });
  const shop = await db.shop.findUnique({ where: { domain }, select: { id: true, uninstalledAt: true } });
  if (!shop || shop.uninstalledAt) return new Response("unknown shop", { status: 404, headers: CORS });

  await db.checkoutAttempt.create({
    data: {
      shopId: shop.id, deviceId, fingerprint: cut(b.fingerprint, 64), ip, checkoutToken: cut(b.checkoutToken, 100), event,
      email: cut(b.email), phone: cut(b.phone, 40), firstName: cut(b.firstName, 80), lastName: cut(b.lastName, 80),
      address1: cut(b.address1), city: cut(b.city, 80), orderId: cut(b.orderId, 80),
      host: cut(b.host, 120), locale: cut(b.locale, 10)?.toLowerCase() ?? null, country: cut(b.country, 4)?.toUpperCase() ?? null,
      currency: cut(b.currency, 4), total: Number.isFinite(Number(b.total)) && b.total !== null ? Number(b.total) : null,
      items: Array.isArray(b.items) ? b.items.slice(0, 10).map((i: any) => ({ title: cut(i?.title, 120) || "", qty: Number(i?.qty) || 1, image: cut(i?.image, 500) })) : undefined,
      acceptsMarketing: typeof b.acceptsMarketing === "boolean" ? b.acceptsMarketing : null,
    },
  });
  // retention: checkout events are kept 120 days (privacy policy)
  if (Math.random() < 0.01) db.checkoutAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 120 * 86_400_000) } } }).catch(() => {});
  return new Response("ok", { headers: CORS });
};
