import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getShop } from "../semafor/shop.server";
import { EMAIL_RE, deviceKnown, markEmbedSeen, popupAllowed, subscribeLead } from "../semafor/popup.server";

/**
 * App proxy (storefront → Shopify → Semafor, HMAC-signed by Shopify): https://<store>/apps/semafor/<path>
 * arrives here as /proxy/<path>. Used by the "Semafor pop-up" theme app embed:
 *   GET  /apps/semafor/ping     — the embed is on (shown in the admin)
 *   GET  /apps/semafor/status   — ?d=<deviceId> → { known } (browser already linked to an e-mail → no pop-up)
 *   POST /apps/semafor/popup    — { email, deviceId, source, locale, pageUrl, consent } → { ok, code }
 */
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const cut = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

const hits = new Map<string, { n: number; t: number }>();
/** true when `key` made more than `max` calls in the last 10 minutes. */
function limited(key: string, max: number) {
  const now = Date.now(); const h = hits.get(key);
  if (h && now - h.t < 600_000) return ++h.n > max;
  hits.set(key, { n: 1, t: now });
  if (hits.size > 50_000) for (const [k, v] of hits) if (now - v.t > 600_000) hits.delete(k);
  return false;
}

async function context(request: Request) {
  const ctx: any = await authenticate.public.appProxy(request); // throws 400/401 when the Shopify signature is wrong
  const domain = ctx?.session?.shop || new URL(request.url).searchParams.get("shop");
  const shop = domain ? await getShop(domain) : null;
  return { admin: ctx?.admin ?? null, shop: shop && !shop.uninstalledAt ? shop : null };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const path = String(params["*"] || "");
  const { shop } = await context(request);
  if (!shop) return json({ ok: false }, 404);
  if (path === "ping") {
    await markEmbedSeen(shop.id).catch((e) => console.error("[semafor] popup ping", e?.message || e));
    return json({ ok: true });
  }
  if (path === "status") {
    const d = cut(new URL(request.url).searchParams.get("d"), 64);
    // pop-up switched off / plan without pop-up → behave as "known" so the embed stays quiet
    if (!shop.settings.popup.enabled || !popupAllowed(shop)) return json({ known: true, off: true });
    return json({ known: d ? await deviceKnown(shop.id, d) : false });
  }
  return json({ ok: false }, 404);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const path = String(params["*"] || "");
  if (request.method !== "POST" || path !== "popup") return json({ ok: false }, 404);
  const { admin, shop } = await context(request);
  if (!shop) return json({ ok: false, error: "unknown shop" }, 404);
  if (!shop.settings.popup.enabled || !popupAllowed(shop)) return json({ ok: false, error: "off" }, 403);

  let b: any;
  try { b = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const email = cut(b?.email, 254)?.toLowerCase() ?? "";
  const deviceId = cut(b?.deviceId, 64);
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid" }, 400);
  if (!deviceId || !/^[A-Za-z0-9_-]{6,64}$/.test(deviceId)) return json({ ok: false, error: "device" }, 400);
  if (b?.consent !== true) return json({ ok: false, error: "consent" }, 400);

  // Shopify forwards the visitor's IP; Railway puts it first in x-forwarded-for
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  if (limited(`d:${shop.id}:${deviceId}`, 6) || limited(`i:${shop.id}:${ip}`, 30)) return json({ ok: false, error: "rate" }, 429);

  const out = await subscribeLead(admin, shop, {
    email, deviceId,
    source: b?.source === "cart" ? "cart" : "site",
    locale: cut(b?.locale, 10)?.toLowerCase() ?? null,
    pageUrl: cut(b?.pageUrl, 500),
  });
  return json({ ok: true, code: out.code });
};
