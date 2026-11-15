import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import db from "../db.server";

/**
 * Ad visits from the store theme (snippet semafor-utm, owner store): UTM labels of a visit that came from an ad,
 * sent only after the visitor accepted cookies, with the same browser id as the Semafor pixel (_smf_dev).
 * Body is JSON sent as text/plain (no CORS preflight).
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const hits = new Map<string, { n: number; t: number }>();
const cut = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

export const loader = async (_: LoaderFunctionArgs) => new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const now = Date.now(); const h = hits.get(ip);
  if (h && now - h.t < 600_000) { if (++h.n > 30) return new Response("slow down", { status: 429, headers: CORS }); } else hits.set(ip, { n: 1, t: now });

  let b: any;
  try { b = JSON.parse(await request.text()); } catch { return new Response("bad json", { status: 400, headers: CORS }); }
  const domain = cut(b.shop, 120); const deviceId = cut(b.deviceId, 64);
  if (!domain || !deviceId || !/^[a-z0-9]{8,64}$/i.test(deviceId)) return new Response("missing", { status: 400, headers: CORS });
  const u = b.utm || {};
  const data = {
    source: cut(u.source, 120), medium: cut(u.medium, 120), campaign: cut(u.campaign, 200), content: cut(u.content, 200),
    term: cut(u.term, 200), campaignId: cut(u.id, 40), fbclid: !!b.fbclid,
    landing: cut(b.landing, 300)?.split("?")[0] ?? null, referrer: cut(b.referrer, 120), host: cut(b.host, 120),
  };
  if (!data.source && !data.campaign && !data.fbclid) return new Response("nothing", { status: 400, headers: CORS });
  const shop = await db.shop.findUnique({ where: { domain }, select: { id: true, uninstalledAt: true } });
  if (!shop || shop.uninstalledAt) return new Response("unknown shop", { status: 404, headers: CORS });

  // the same ad again within 30 minutes (page reloads, several product pages) → one visit
  const last = (await db.adTouch.findFirst({ where: { shopId: shop.id, deviceId }, orderBy: { createdAt: "desc" }, select: { createdAt: true, campaign: true, content: true, source: true } })) as any;
  if (last && now - +last.createdAt < 30 * 60_000 && last.campaign === data.campaign && last.content === data.content && last.source === data.source) return new Response("ok", { headers: CORS });
  await db.adTouch.create({ data: { shopId: shop.id, deviceId, ...data } });
  return new Response("ok", { headers: CORS });
};
