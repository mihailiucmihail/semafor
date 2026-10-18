import { allPopupCodes } from "../../core/popup";
/**
 * Order attribution: was this order brought by Semafor (pop-up / reminder e-mail), and how?
 * Run for every new order right after the traffic-light check (check-order.server.ts):
 *  - finds the buyer's browsers (CheckoutAttempt rows of the order's checkout token / order id) and e-mail,
 *  - collects the Semafor touches before the order (PopupLead, reminder EmailSend) → core/attribution.ts decides,
 *  - stores it on OrderCheck (+ order total / currency / time for the revenue KPIs),
 *  - when attributed: order tag "Semafor · …" and a "Semafor" note attribute (setting tagAttributed), and the
 *    order metafield semafor.attribution (JSON).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { decideAttribution, ATTR_TAG, ALL_ATTR_TAGS, EMAIL_WINDOW_DAYS, POPUP_WINDOW_DAYS, type Attribution, type AttrSource } from "../../core/attribution";
import type { ShopSettings } from "../../core/settings";
import { shopLang } from "../i18n.server";
import { EXTRA, dateLocale, type Lang } from "../i18n";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };
const DAY = 86_400_000;

async function gql(admin: Admin, q: string, variables?: any) {
  const r = await admin.graphql(q, variables ? { variables } : undefined);
  const j: any = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

/** Order in the webhook (REST) shape — the fields used here. */
export type OrderLike = {
  admin_graphql_api_id: string; email?: string | null; customer?: { email?: string | null } | null; checkout_token?: string | null;
  created_at?: string | null; discount_codes?: Array<{ code?: string | null }> | null; total_price?: string | number | null; currency?: string | null;
};

/** Touches of one buyer before `orderAt` → attribution (pure DB, no Shopify calls). */
export async function computeAttribution(db: PrismaClient, shop: { id: string; settings: ShopSettings }, o: OrderLike): Promise<Attribution> {
  const email = String(o.email || o.customer?.email || "").trim().toLowerCase();
  const orderAt = o.created_at ? new Date(o.created_at) : new Date();
  const rows = (await db.checkoutAttempt.findMany({
    where: { shopId: shop.id, OR: [{ orderId: o.admin_graphql_api_id }, ...(o.checkout_token ? [{ checkoutToken: o.checkout_token }] : [])] },
    select: { deviceId: true },
  })) as Array<{ deviceId: string }>;
  const devs = [...new Set(rows.map((r) => r.deviceId))];
  const who = (emailField: object) => [...(email ? [emailField] : []), ...(devs.length ? [{ deviceId: { in: devs } }] : [])];
  const leadWho = who({ email });
  const sendWho = who({ email: { equals: email, mode: "insensitive" } });
  const leads = leadWho.length ? ((await db.popupLead.findMany({
    where: { shopId: shop.id, createdAt: { lt: orderAt, gt: new Date(+orderAt - POPUP_WINDOW_DAYS * DAY) }, OR: leadWho as any },
    select: { source: true, createdAt: true },
  })) as any[]) : [];
  const sends = sendWho.length ? ((await db.emailSend.findMany({
    where: { shopId: shop.id, status: "sent", kind: { in: ["auto1", "auto2", "auto3", "manual"] }, createdAt: { lt: orderAt, gt: new Date(+orderAt - EMAIL_WINDOW_DAYS * DAY) }, OR: sendWho as any },
    select: { kind: true, createdAt: true, discountCode: true },
  })) as any[]) : [];
  return decideAttribution({
    orderAt, leads, sends,
    discountCodes: (o.discount_codes ?? []).map((d) => String(d?.code || "")),
    popupCodes: shop.settings.popup ? allPopupCodes(shop.settings.popup) : [],
  });
}

const SRC_NOTE: Record<"ro" | "en", Record<AttrSource, string>> = {
  ro: { popup_site: "pop-up", popup_cart: "pop-up în coș", email: "e-mail de reamintire" },
  en: { popup_site: "pop-up", popup_cart: "pop-up in cart", email: "reminder e-mail" },
};

/** Line for the order's note attributes: "Semafor: pop-up în coș · 11 oct 14:05 · cod BUNVENIT15". */
export function attributionNote(a: Attribution, lang: Lang, tz: string) {
  if (!a.primary || !a.at) return "";
  let when = "";
  const x = lang === "en" || lang === "ro" ? null : EXTRA[lang].srcNote;
  try { when = new Date(a.at).toLocaleString(lang === "en" ? "en-GB" : dateLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }); } catch { when = a.at; }
  const src = x ? x[a.primary] : SRC_NOTE[lang === "ro" ? "ro" : "en"][a.primary];
  const code = x ? x.code : lang === "ro" ? "cod" : "code";
  return [src, when, a.usedCode ? `${code} ${a.usedCode}` : ""].filter(Boolean).join(" · ");
}

/** Computes, stores and (when attributed) writes tag / note attribute / metafield on the order. Never throws. */
export async function attributeOrder(db: PrismaClient, admin: Admin, shop: { id: string; domain: string; settings: ShopSettings }, o: OrderLike) {
  try {
    const a = await computeAttribution(db, shop, o);
    const total = o.total_price != null && Number.isFinite(Number(o.total_price)) ? Number(o.total_price) : null;
    await db.orderCheck.updateMany({
      where: { shopId: shop.id, orderId: o.admin_graphql_api_id },
      data: { attribution: a as any, total, currency: o.currency || null, orderedAt: o.created_at ? new Date(o.created_at) : new Date() },
    });
    if (!a.primary) return a;
    const lang = shopLang(shop);
    // order tags stay Romanian or English (they are filters other tools rely on); the note follows the admin language
    const tagLang = lang === "ro" ? "ro" : "en";
    const d = await gql(admin, `query($id:ID!){ order(id:$id){ tags customAttributes{ key value } } shop{ ianaTimezone } }`, { id: o.admin_graphql_api_id });
    const tags: string[] = d?.order?.tags ?? [];
    const input: any = { id: o.admin_graphql_api_id, metafields: [{ namespace: "semafor", key: "attribution", type: "json", value: JSON.stringify(a) }] };
    if (shop.settings.tagAttributed !== false) {
      const tag = ATTR_TAG[tagLang][a.primary];
      const stale = tags.filter((t) => t !== tag && ALL_ATTR_TAGS.includes(t));
      if (stale.length) await gql(admin, `mutation($id:ID!,$tags:[String!]!){ tagsRemove(id:$id,tags:$tags){ userErrors{ message } } }`, { id: o.admin_graphql_api_id, tags: stale });
      if (!tags.includes(tag)) await gql(admin, `mutation($id:ID!,$tags:[String!]!){ tagsAdd(id:$id,tags:$tags){ userErrors{ message } } }`, { id: o.admin_graphql_api_id, tags: [tag] });
      // keep the merchant's / theme's attributes, replace only our own line
      const attrs = ((d?.order?.customAttributes ?? []) as Array<{ key: string; value: string }>).filter((x) => x.key !== "Semafor");
      input.customAttributes = [...attrs, { key: "Semafor", value: attributionNote(a, lang, d?.shop?.ianaTimezone || "Europe/Bucharest") }];
    }
    const r = await gql(admin, `mutation($input: OrderInput!){ orderUpdate(input:$input){ order{ id } userErrors{ field message } } }`, { input });
    const ue = r?.orderUpdate?.userErrors ?? [];
    if (ue.length) console.error("[semafor] attribution orderUpdate", JSON.stringify(ue));
    return a;
  } catch (e: any) {
    console.error("[semafor] attribution", shop.domain, e?.message || e);
    return null;
  }
}

const backfilled = new Map<string, number>();
/**
 * Orders checked in the last 30 days without attribution yet: computed and stored in the DB only (old orders are
 * not tagged — they may be shipped / archived and it would be many writes). One Admin call for up to 100 orders,
 * at most every 10 minutes per shop.
 */
export async function backfillAttribution(db: PrismaClient, admin: Admin, shop: { id: string; settings: ShopSettings }) {
  const last = backfilled.get(shop.id) ?? 0;
  if (Date.now() - last < 10 * 60_000) return 0;
  backfilled.set(shop.id, Date.now());
  try {
    const todo = (await db.orderCheck.findMany({ where: { shopId: shop.id, checkedAt: { gt: new Date(Date.now() - 30 * DAY) }, attribution: { equals: Prisma.DbNull } }, select: { orderId: true }, take: 100 })) as Array<{ orderId: string }>;
    if (!todo.length) return 0;
    const d = await gql(admin, `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Order { id createdAt email discountCodes totalPriceSet{ shopMoney{ amount currencyCode } } customer{ defaultEmailAddress{ emailAddress } } } } }`, { ids: todo.map((t) => t.orderId) });
    let n = 0;
    for (const o of (d?.nodes ?? []) as any[]) {
      if (!o?.id) continue;
      const like: OrderLike = {
        admin_graphql_api_id: o.id, email: o.email || o.customer?.defaultEmailAddress?.emailAddress || null, created_at: o.createdAt,
        discount_codes: (o.discountCodes ?? []).map((c: string) => ({ code: c })), total_price: o.totalPriceSet?.shopMoney?.amount ?? null, currency: o.totalPriceSet?.shopMoney?.currencyCode ?? null,
      };
      const a = await computeAttribution(db, shop, like);
      await db.orderCheck.updateMany({ where: { shopId: shop.id, orderId: o.id }, data: { attribution: a as any, total: like.total_price != null ? Number(like.total_price) : null, currency: like.currency, orderedAt: new Date(o.createdAt) } });
      n++;
    }
    // orders that no longer exist: mark as computed so they are not asked again
    const found = new Set(((d?.nodes ?? []) as any[]).filter(Boolean).map((x) => x.id));
    for (const t of todo) if (!found.has(t.orderId)) await db.orderCheck.updateMany({ where: { shopId: shop.id, orderId: t.orderId }, data: { attribution: { v: 1, primary: null, at: null, delayMin: null, touches: [], usedCode: null, codeSource: null } as any } });
    return n;
  } catch (e: any) {
    console.error("[semafor] attribution backfill", e?.message || e);
    return 0;
  }
}

export type AttrSummary = { count: number; revenue: number; currency: string | null; bySource: Record<AttrSource, { count: number; revenue: number }> };
/** Orders brought by Semafor in the last `days` days (KPI cards). `only` limits the sources counted. */
export async function attributionSummary(db: PrismaClient, shopId: string, days = 30, only?: AttrSource[]): Promise<AttrSummary> {
  const since = new Date(Date.now() - days * DAY);
  const rows = (await db.orderCheck.findMany({ where: { shopId, checkedAt: { gt: since }, NOT: { attribution: { equals: Prisma.DbNull } } }, select: { attribution: true, total: true, currency: true } })) as any[];
  const out: AttrSummary = { count: 0, revenue: 0, currency: null, bySource: { popup_site: { count: 0, revenue: 0 }, popup_cart: { count: 0, revenue: 0 }, email: { count: 0, revenue: 0 } } };
  const cur = new Map<string, number>();
  for (const r of rows) {
    const p = (r.attribution as Attribution | null)?.primary;
    if (!p || (only && !only.includes(p))) continue;
    const t = Number(r.total) || 0;
    out.count++; out.revenue += t; out.bySource[p].count++; out.bySource[p].revenue += t;
    if (r.currency) cur.set(r.currency, (cur.get(r.currency) ?? 0) + 1);
  }
  out.currency = [...cur.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  out.revenue = Math.round(out.revenue * 100) / 100;
  return out;
}
