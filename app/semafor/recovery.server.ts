/**
 * Abandoned-checkout recovery e-mails.
 *  - builds the e-mail for one device (buyer) from its checkout steps,
 *  - optionally creates a one-time discount code (Shopify, write_discounts),
 *  - links back to the buyer's own Shopify checkout (abandoned checkout URL, on the store domain she used),
 *  - sends through Resend (env RESEND_API_KEY) and logs every send in EmailSend,
 *  - runs the automatic 1st / 2nd reminder every 5 minutes.
 */
import { can } from "../../core/plans";
import { planOf } from "./plan.server";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { settingsOf, type RecoverySettings } from "../../core/settings";
import { defaultTemplates } from "./recovery-templates";
import { render, esc, STEP_LABEL, stoppedAt, STEP_ORDER } from "./render";
import { createHmac } from "node:crypto";
import { SECRET } from "./shop.server";
import { buildEmail, productBlock, isDesign, DEFAULT_COPY, type Brand, type Copy, type Item } from "./designs";
export { render, STEP_LABEL, stoppedAt, STEP_ORDER };

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };
const DAY = 86_400_000;

export async function ensureTemplates(shopId: string) {
  const n = await db.emailTemplate.count({ where: { shopId } });
  if (n) return;
  await db.emailTemplate.createMany({ data: defaultTemplates().map((t) => ({ ...t, shopId })) });
}

/** Everything Semafor knows about one buyer (device). */
export async function deviceContext(shopId: string, deviceId: string) {
  const steps = (await db.checkoutAttempt.findMany({ where: { shopId, deviceId }, orderBy: { createdAt: "asc" }, take: 500 })) as any[];
  if (!steps.length) return null;
  const last = <K extends string>(k: K) => { for (let i = steps.length - 1; i >= 0; i--) if (steps[i][k] != null && steps[i][k] !== "") return steps[i][k]; return null; };
  const withItems = [...steps].reverse().find((s) => Array.isArray(s.items) && s.items.length);
  const events = [...new Set(steps.map((s) => s.event))];
  return {
    steps, events,
    email: last("email") as string | null, phone: last("phone") as string | null,
    firstName: last("firstName") as string | null, lastName: last("lastName") as string | null, city: last("city") as string | null,
    host: last("host") as string | null, locale: (last("locale") as string | null) || null, country: last("country") as string | null,
    currency: (withItems?.currency ?? last("currency")) as string | null, total: (withItems?.total ?? last("total")) as number | null,
    items: (withItems?.items ?? []) as { title: string; qty: number; image?: string | null; variant?: string | null; price?: number | string | null }[],
    acceptsMarketing: last("acceptsMarketing") as boolean | null,
    cartDiscountCode: last("discountCode") as string | null,
    cartDiscountPct: last("discountPct") as number | null,
    checkoutToken: last("checkoutToken") as string | null,
    completed: events.includes("completed"),
    firstAt: steps[0].createdAt as Date, lastAt: steps[steps.length - 1].createdAt as Date,
  };
}
export type DeviceCtx = NonNullable<Awaited<ReturnType<typeof deviceContext>>>;

/**
 * Fill in e-mail / phone / name for checkouts where the buyer typed them but never pressed a button
 * (one-page checkout: the pixel only sees them on "continue"/"pay"). Shopify keeps them in the
 * abandoned checkout, whose recovery URL carries the same checkout token as the pixel.
 * Only empty fields are filled. Returns how many checkouts were completed with data.
 */
export async function enrichFromShopify(admin: Admin, shopId: string, sinceDays = 7): Promise<number> {
  const since = new Date(Date.now() - sinceDays * DAY);
  const missing = (await db.checkoutAttempt.findMany({ where: { shopId, createdAt: { gt: since }, email: null, checkoutToken: { not: null } }, select: { checkoutToken: true }, distinct: ["checkoutToken"] })) as any[];
  if (!missing.length) return 0;
  const want = new Set(missing.map((m) => m.checkoutToken as string));
  const found = new Map<string, { email: string | null; phone: string | null; firstName: string | null; lastName: string | null; city: string | null }>();
  let after: string | null = null;
  for (let page = 0; page < 8 && want.size > found.size; page++) {
    let d: any;
    try {
      d = await gql(admin, `query($after:String){ abandonedCheckouts(first:100, after:$after, reverse:true, sortKey:CREATED_AT){
        pageInfo{ hasNextPage endCursor }
        nodes{ createdAt abandonedCheckoutUrl customer{ email phone } shippingAddress{ phone firstName lastName city } billingAddress{ phone firstName lastName city } } } }`, { after });
    } catch (e: any) { console.error("[semafor] enrich", e?.message || e); break; }
    const conn = d?.abandonedCheckouts;
    let older = false;
    for (const n of conn?.nodes ?? []) {
      if (new Date(n.createdAt) < since) { older = true; continue; }
      const tok = String(n.abandonedCheckoutUrl || "").match(/\/checkouts\/(?:ac|cn|c)\/([^/?]+)/)?.[1];
      if (!tok || !want.has(tok)) continue;
      const a = n.shippingAddress || n.billingAddress || {};
      found.set(tok, { email: n.customer?.email ?? null, phone: n.customer?.phone ?? a.phone ?? null, firstName: a.firstName ?? null, lastName: a.lastName ?? null, city: a.city ?? null });
    }
    if (older || !conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  let n = 0;
  for (const [tok, v] of found) {
    if (!v.email && !v.phone) continue;
    const rows = (await db.checkoutAttempt.findMany({ where: { shopId, checkoutToken: tok }, select: { id: true, email: true, phone: true, firstName: true, lastName: true, city: true } })) as any[];
    for (const r of rows) {
      const data: any = {};
      for (const k of ["email", "phone", "firstName", "lastName", "city"] as const) if (!r[k] && (v as any)[k]) data[k] = (v as any)[k];
      if (Object.keys(data).length) await db.checkoutAttempt.update({ where: { id: r.id }, data });
    }
    n++;
  }
  return n;
}

/** Language for the e-mail: checkout language, else by country, else Romanian. */
export function localeOf(ctx: Pick<DeviceCtx, "locale" | "country" | "host">) {
  const l = (ctx.locale || "").slice(0, 2);
  if (l) return l;
  const c = (ctx.country || "").toUpperCase();
  if (c === "DE" || c === "AT" || c === "CH") return "de";
  if (c === "PL") return "pl";
  if ((ctx.host || "").endsWith(".de")) return "de";
  if ((ctx.host || "").endsWith(".pl")) return "pl";
  return "ro";
}

async function gql(admin: Admin, q: string, variables?: any) {
  const r = await admin.graphql(q, variables ? { variables } : undefined);
  const j: any = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

/** E-mail marketing consent of the Shopify customer with this e-mail (SUBSCRIBED / NOT_SUBSCRIBED / …). */
export async function consentOf(admin: Admin, email: string): Promise<string | null> {
  try {
    const d = await gql(admin, `query($q:String!){ customers(first:1, query:$q){ nodes{ emailMarketingConsent{ marketingState } } } }`, { q: `email:${JSON.stringify(email)}` });
    return d?.customers?.nodes?.[0]?.emailMarketingConsent?.marketingState ?? null;
  } catch { return null; }
}

/** HTML of a sent e-mail: stored copy, else fetched from Resend (e-mails sent before copies were stored). */
export async function sentEmailHtml(send: { id: string; html?: string | null; providerId?: string | null }) {
  if (send.html) return send.html;
  const key = process.env.RESEND_API_KEY;
  if (!key || !send.providerId) return null;
  try {
    const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(send.providerId)}`, { headers: { Authorization: `Bearer ${key}` } });
    const j: any = await r.json();
    const html = typeof j?.html === "string" ? j.html : null;
    if (html) await db.emailSend.update({ where: { id: send.id }, data: { html } }).catch(() => {});
    return html;
  } catch { return null; }
}

/** Signed unsubscribe link for one buyer of one shop. */
export function unsubToken(shopId: string, email: string) {
  const e = email.trim().toLowerCase();
  const sig = createHmac("sha256", SECRET).update(`unsub:${shopId}:${e}`).digest("base64url").slice(0, 22);
  return Buffer.from(JSON.stringify([shopId, e, sig])).toString("base64url");
}
export function readUnsubToken(t: string): { shopId: string; email: string } | null {
  try {
    const [shopId, email, sig] = JSON.parse(Buffer.from(t, "base64url").toString("utf8"));
    const ok = createHmac("sha256", SECRET).update(`unsub:${shopId}:${email}`).digest("base64url").slice(0, 22);
    return ok === sig ? { shopId, email } : null;
  } catch { return null; }
}
export function unsubUrl(shopId: string, email: string) {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return `${base}/unsub?t=${unsubToken(shopId, email)}`;
}
export const UNSUB_LABEL: Record<string, { link: string; why: string }> = {
  ro: { link: "Dezabonare", why: "Primești acest e-mail pentru că ai început o comandă la {{shop_name}}." },
  de: { link: "Abmelden", why: "Du erhältst diese E-Mail, weil du eine Bestellung bei {{shop_name}} begonnen hast." },
  pl: { link: "Wypisz się", why: "Otrzymujesz tę wiadomość, ponieważ rozpoczęłaś zamówienie w {{shop_name}}." },
  en: { link: "Unsubscribe", why: "You're receiving this e-mail because you started an order at {{shop_name}}." },
};

/** Placeholder for the unsubscribe URL until the real (per-buyer) link is known. */
export const UNSUB_PH = "https://unsubscribe.invalid/semafor";
export function unsubVars(locale: string, shopName: string) {
  const L = UNSUB_LABEL[locale] || UNSUB_LABEL.en;
  return { unsubscribe_url: UNSUB_PH, unsubscribe_label: L.link, unsubscribe_why: L.why.replace("{{shop_name}}", shopName) };
}

export async function isOptedOut(shopId: string, email: string) {
  return !!(await db.emailOptOut.findUnique({ where: { shopId_email: { shopId, email: email.trim().toLowerCase() } } }));
}

/** Unsubscribe: stop Semafor e-mails and set the buyer's e-mail marketing consent to UNSUBSCRIBED in Shopify. */
export async function unsubscribe(admin: Admin | null, shopId: string, email: string) {
  const e = email.trim().toLowerCase();
  await db.emailOptOut.upsert({ where: { shopId_email: { shopId, email: e } }, create: { shopId, email: e }, update: {} });
  if (!admin) return { shopify: false };
  try {
    const d = await gql(admin, `query($q:String!){ customers(first:1, query:$q){ nodes{ id } } }`, { q: `email:${JSON.stringify(e)}` });
    const id = d?.customers?.nodes?.[0]?.id;
    if (!id) return { shopify: false }; // no customer in Shopify → Shopify never e-mails her anyway
    const r = await gql(admin, `mutation($input: CustomerEmailMarketingConsentUpdateInput!){ customerEmailMarketingConsentUpdate(input:$input){ customer{ id } userErrors{ field message } } }`,
      { input: { customerId: id, emailMarketingConsent: { marketingState: "UNSUBSCRIBED", consentUpdatedAt: new Date().toISOString() } } });
    const errs = r?.customerEmailMarketingConsentUpdate?.userErrors ?? [];
    if (errs.length) console.error("[semafor] unsub shopify", errs);
    return { shopify: !errs.length };
  } catch (err: any) { console.error("[semafor] unsub", err?.message || err); return { shopify: false }; }
}

/** Footer with the unsubscribe link, added to every e-mail (also to own-HTML templates that lack it). */
export function withUnsubFooter(html: string, url: string, locale: string, shopName: string) {
  const L = UNSUB_LABEL[locale] || UNSUB_LABEL.en;
  const esc2 = (x: string) => esc(x);
  if (html.includes("{{unsubscribe_url}}") || html.includes(url)) return html;
  const foot = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:14px 16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9a9087">${esc2(L.why.replace("{{shop_name}}", shopName))}<br><a href="${esc2(url)}" style="color:#9a9087;text-decoration:underline">${esc2(L.link)}</a></td></tr></table>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, foot + "</body>") : html + foot;
}

/** True when this e-mail already has an order placed after `since`. */
export async function orderedSince(admin: Admin, email: string, since: Date): Promise<boolean> {
  try {
    const d = await gql(admin, `query($q:String!){ orders(first:1, query:$q){ nodes{ id } } }`, { q: `email:${JSON.stringify(email)} created_at:>=${since.toISOString()}` });
    return (d?.orders?.nodes?.length ?? 0) > 0;
  } catch { return false; }
}

/** The buyer's own checkout (Shopify abandoned-checkout recovery URL), moved to the store domain she used. */
/** Link that applies a discount code and then opens `url` (Shopify /discount/<code>?redirect=…). */
export function withDiscountLink(url: string, code: string) {
  try { const u = new URL(url); return `${u.origin}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(u.pathname + u.search)}`; } catch { return url; }
}

/** Shopify cart permalink that puts the products in the cart: /cart/<variant>:<qty>,… */
export function cartPermalink(base: string, items: Array<{ variantId?: string | null; qty?: number }>) {
  const parts = items.map((i) => { const id = String(i.variantId || "").split("/").pop(); return id && /^\d+$/.test(id) ? `${id}:${Math.max(1, Number(i.qty) || 1)}` : null; }).filter(Boolean);
  return parts.length ? `${base.replace(/\/$/, "")}/cart/${parts.join(",")}` : `${base.replace(/\/$/, "")}/cart`;
}

export async function recoveryUrl(admin: Admin, ctx: DeviceCtx, shopDomain: string): Promise<string> {
  const host = ctx.host || null;
  let url: string | null = null;
  if (ctx.email) {
    try {
      const d = await gql(admin, `query($q:String!){ abandonedCheckouts(first:1, reverse:true, sortKey:CREATED_AT, query:$q){ nodes{ abandonedCheckoutUrl } } }`, { q: `email:${JSON.stringify(ctx.email)}` });
      url = d?.abandonedCheckouts?.nodes?.[0]?.abandonedCheckoutUrl ?? null;
    } catch { url = null; }
  }
  if (!url) return cartPermalink(`https://${host || shopDomain}`, ctx.items as any);
  if (!host) return url;
  try { const u = new URL(url); u.host = host; return u.toString(); } catch { return url; }
}

/** One-time percentage code valid for `hours`, for everything in the store. */
export async function createDiscount(admin: Admin, pct: number, hours: number, label: string, combine = false) {
  const code = `GIFT${pct}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const endsAt = new Date(Date.now() + hours * 3_600_000);
  const d = await gql(admin, `mutation($d: DiscountCodeBasicInput!){ discountCodeBasicCreate(basicCodeDiscount:$d){ codeDiscountNode{ id } userErrors{ field message } } }`, {
    d: {
      title: `Semafor ${label} ${code}`, code, startsAt: new Date().toISOString(), endsAt: endsAt.toISOString(),
      usageLimit: 1, appliesOncePerCustomer: true,
      context: { all: "ALL" },
      customerGets: { value: { percentage: pct / 100 }, items: { all: true } },
      combinesWith: { orderDiscounts: combine, productDiscounts: combine, shippingDiscounts: true },
    },
  });
  const errs = d?.discountCodeBasicCreate?.userErrors ?? [];
  if (errs.length) throw new Error("Reducere: " + errs.map((e: any) => e.message).join("; "));
  return { code, endsAt };
}


function money(v: number | null, cur: string | null, locale: string) {
  if (v == null) return "";
  try { return new Intl.NumberFormat(locale === "ro" ? "ro-RO" : locale === "pl" ? "pl-PL" : "de-DE", { style: "currency", currency: cur || "EUR" }).format(v); } catch { return `${v} ${cur || ""}`; }
}

function itemsHtml(items: DeviceCtx["items"]) {
  if (!items.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;border-top:1px solid #eee3d6">${items.map((i) => `<tr><td width="72" style="padding:10px 0;border-bottom:1px solid #eee3d6">${i.image ? `<img src="${esc(i.image)}" width="60" height="60" alt="" style="display:block;object-fit:cover;border:0">` : ""}</td><td style="padding:10px 0 10px 12px;border-bottom:1px solid #eee3d6;font-family:Arial,sans-serif;font-size:14px;color:#2a1a12">${esc(i.title)}${i.qty > 1 ? ` × ${i.qty}` : ""}${i.price ? ` · ${esc(String(i.price))}` : ""}</td></tr>`).join("")}</table>`;
}

/**
 * Sending goes through Semafor's own Resend account — merchants set up nothing.
 *  - default sender: "<Shop name> <<shop-handle>@SEMAFOR_MAIL_DOMAIN>", replies go to the shop's e-mail;
 *  - a merchant may use an own address only when its domain is verified in Semafor's Resend account.
 */
export const MAIL_DOMAIN = (process.env.SEMAFOR_MAIL_DOMAIN || "").trim().toLowerCase();
export const DAILY_LIMIT = Number(process.env.SEMAFOR_DAILY_LIMIT) || 300;
export function mailReady() { return !!process.env.RESEND_API_KEY && !!MAIL_DOMAIN; }

let verifiedCache: { at: number; domains: Set<string> } | null = null;
/** Domains verified in Semafor's Resend account (cached 10 min). */
export async function verifiedDomains(): Promise<Set<string>> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return new Set();
  if (verifiedCache && Date.now() - verifiedCache.at < 600_000) return verifiedCache.domains;
  try {
    const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
    const j: any = await r.json();
    const set = new Set<string>(((j?.data ?? []) as any[]).filter((d) => d.status === "verified").map((d) => String(d.name).toLowerCase()));
    verifiedCache = { at: Date.now(), domains: set };
    return set;
  } catch { return verifiedCache?.domains ?? new Set(); }
}

function shopSlug(shopDomain: string) {
  return shopDomain.replace(/\.myshopify\.com$/, "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "shop";
}

/** The From address actually used for a shop. */
export async function senderOf(shopDomain: string, s: Pick<RecoverySettings, "fromEmail">) {
  const own = (s.fromEmail || "").trim().toLowerCase();
  if (own && own.includes("@")) {
    const dom = own.split("@")[1];
    const ok = await verifiedDomains();
    if ([...ok].some((d) => dom === d || dom.endsWith("." + d))) return own;
  }
  return MAIL_DOMAIN ? `${shopSlug(shopDomain)}@${MAIL_DOMAIN}` : "";
}

/** Shop name + contact e-mail (default sender name and reply-to). */
export async function shopIdentity(admin: Admin) {
  try {
    const d = await gql(admin, `query{ shop{ name contactEmail email } }`);
    return { name: d?.shop?.name as string || "", email: (d?.shop?.contactEmail || d?.shop?.email || "") as string };
  } catch { return { name: "", email: "" }; }
}

export async function sendMail(m: { to: string; subject: string; html: string; fromName: string; fromEmail: string; replyTo?: string; unsubscribeUrl?: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Trimiterea e-mailurilor nu este încă activă (configurare Semafor).");
  if (!m.fromEmail) throw new Error("Trimiterea e-mailurilor nu este încă activă (domeniul de trimitere Semafor).");
  const name = (m.fromName || "").replace(/[<>"]/g, "").trim();
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: name ? `${name} <${m.fromEmail}>` : m.fromEmail, to: [m.to], subject: m.subject, html: m.html, ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      // one-click unsubscribe (Gmail / Yahoo bulk-sender rules, RFC 8058)
      ...(m.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${m.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}) }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${j?.message || JSON.stringify(j).slice(0, 200)}`);
  return String(j?.id || "");
}

/** Discount already applied in the buyer's checkout (pop-up code …): Shopify's abandoned checkout first, else what the pixel saw. */
export async function cartDiscountOf(admin: Admin, ctx: Pick<DeviceCtx, "email" | "cartDiscountCode" | "cartDiscountPct">): Promise<{ code: string | null; pct: number | null }> {
  if (ctx.email) {
    try {
      const d = await gql(admin, `query($q:String!){ abandonedCheckouts(first:1, reverse:true, sortKey:CREATED_AT, query:$q){ nodes{ discountCodes totalDiscountSet{ shopMoney{ amount } } subtotalPriceSet{ shopMoney{ amount } } } } }`, { q: `email:${JSON.stringify(ctx.email)}` });
      const n = d?.abandonedCheckouts?.nodes?.[0];
      const off = Number(n?.totalDiscountSet?.shopMoney?.amount || 0);
      const sub = Number(n?.subtotalPriceSet?.shopMoney?.amount || 0);
      const code = (n?.discountCodes ?? [])[0] ?? null;
      if (off > 0 || code) return { code: code || ctx.cartDiscountCode || null, pct: ctx.cartDiscountPct ?? (sub > 0 && off > 0 ? Math.round((off / (sub + off)) * 100) : null) };
    } catch { /* fall back to the pixel */ }
  }
  return { code: ctx.cartDiscountCode ?? null, pct: ctx.cartDiscountPct ?? null };
}

/** Products of the buyer's abandoned checkout, read from Shopify (when the pixel did not capture them). */
export async function shopifyCartItems(admin: Admin, email: string): Promise<{ items: Item[]; currency: string | null; total: number | null }> {
  try {
    const d = await gql(admin, `query($q:String!){ abandonedCheckouts(first:1, reverse:true, sortKey:CREATED_AT, query:$q){ nodes{ lineItems(first:10){ nodes{ title variantTitle quantity variant{ id } image{ url } discountedTotalPriceSet{ presentmentMoney{ amount currencyCode } } } } } } }`, { q: `email:${JSON.stringify(email)}` });
    const nodes: any[] = d?.abandonedCheckouts?.nodes?.[0]?.lineItems?.nodes ?? [];
    let cur: string | null = null, tot = 0;
    const items: Item[] = nodes.filter((n) => n?.title).map((n) => {
      const m = n.discountedTotalPriceSet?.presentmentMoney; if (m) { cur = m.currencyCode; tot += Number(m.amount) || 0; }
      return { title: n.title, qty: n.quantity || 1, image: n.image?.url ?? null, variant: n.variantTitle ?? null, variantId: n.variant?.id ?? null, price: m ? Number(m.amount) : null } as any;
    });
    return { items, currency: cur, total: tot || null };
  } catch { return { items: [], currency: null, total: null }; }
}

/** Brand used by the designed templates. */
export function brandOf(s: Pick<RecoverySettings, "brandName" | "brandTagline" | "logoUrl" | "accent">, shopName: string): Brand {
  return { name: s.brandName || shopName, tagline: s.brandTagline || "", logoUrl: s.logoUrl || "", accent: s.accent || "" };
}

/** Subject + HTML of a template (designed templates are built from design + texts + brand). */
export function templateSource(tpl: { subject: string; html: string; design?: string | null; copy?: unknown }, brand: Brand) {
  if (isDesign(tpl.design)) {
    const copy = { ...((tpl.copy ?? {}) as Copy) };
    // every e-mail reminds her of the discount already in her cart (shown only when there is one)
    if (!copy.existing) copy.existing = ((DEFAULT_COPY as any)[(tpl as any).locale] ?? DEFAULT_COPY.en).auto2.existing;
    return { subject: tpl.subject, html: buildEmail(tpl.design, copy, brand) };
  }
  return { subject: tpl.subject, html: tpl.html };
}

/** Variables describing the buyer's products. */
export function productVars(design: string | null | undefined, items: Item[], brand: Brand) {
  return {
    items: itemsHtml(items as any),
    product_block: productBlock(isDesign(design) ? design : "elegant", items, brand.accent),
    product_title: items[0]?.title || "",
  };
}

/** One real product of the shop, for test e-mails and previews. */
export async function sampleItems(admin: Admin, shopId?: string): Promise<Item[]> {
  // 1) the latest real cart seen by the pixel (no extra permissions needed)
  if (shopId) {
    try {
      const rows = (await db.checkoutAttempt.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 300, select: { items: true, currency: true, locale: true } })) as any[];
      const row = rows.find((r) => Array.isArray(r.items) && r.items.some((i: any) => i?.image));
      if (row) {
        const it = (row.items as any[]).find((i) => i?.image);
        return [{ title: it.title, qty: 1, image: it.image, variant: it.variant ?? null, variantId: it.variantId ?? null, price: typeof it.price === "number" ? money(it.price / (Number(it.qty) || 1), row.currency, (row.locale || "ro").slice(0, 2)) : null }];
      }
    } catch (e) { console.error("[semafor] sampleItems db", e); }
  }
  // 2) the catalogue (only when the app has read_products)
  try {
    const d = await gql(admin, `query{ products(first:10, sortKey:UPDATED_AT, reverse:true, query:"status:active") { nodes { title totalInventory featuredMedia { preview { image { url } } } variants(first:1){ nodes { title price } } } } shop { currencyCode } }`);
    const nodes: any[] = d?.products?.nodes ?? [];
    const p = nodes.find((n) => n.featuredMedia?.preview?.image?.url && n.totalInventory > 0) || nodes.find((n) => n.featuredMedia?.preview?.image?.url);
    if (!p) return [];
    const v = p.variants?.nodes?.[0];
    return [{ title: p.title, qty: 1, image: p.featuredMedia.preview.image.url, variant: v?.title ?? null, price: v?.price ? money(Number(v.price), d?.shop?.currencyCode, "ro") : null }];
  } catch { return []; }
}

export type SendInput = { shopId: string; shopDomain: string; admin: Admin; deviceId: string; templateId: string; pct: number; validHours: number; kind: "manual" | "auto1" | "auto2" | "auto3"; preview?: boolean; settings: RecoverySettings;
  /** Code valid until this moment instead of validHours (3rd e-mail: end of the buyer's day). */ validUntil?: Date;
  /** Discount already in the cart (decided by the caller). */ cartDiscount?: { code: string | null; pct: number | null } };

/** Build (and unless preview, send) one recovery e-mail. Returns the rendered e-mail. */
export async function sendRecovery(i: SendInput) {
  const ctx = await deviceContext(i.shopId, i.deviceId);
  if (!ctx) throw new Error("Client necunoscut");
  if (!ctx.email) throw new Error("Clientul nu a introdus un e-mail.");
  if (!i.preview && await isOptedOut(i.shopId, ctx.email)) throw new Error("Clienta s-a dezabonat de la e-mailuri.");
  if (!ctx.items.length) {
    const sc = await shopifyCartItems(i.admin, ctx.email);
    if (sc.items.length) { ctx.items = sc.items as any; ctx.currency = ctx.currency || sc.currency; ctx.total = ctx.total ?? sc.total; }
  }
  // never send a reminder that shows no product
  if (!ctx.items.length && i.kind !== "manual") throw new Error("NO_ITEMS");
  const tpl = await db.emailTemplate.findFirst({ where: { id: i.templateId, shopId: i.shopId } });
  if (!tpl) throw new Error("Șablonul nu există.");
  const locale = tpl.locale || localeOf(ctx);
  // always know the discount already in her cart (manual sends too)
  if (i.cartDiscount === undefined && !i.preview) {
    const c = await cartDiscountOf(i.admin, ctx);
    if (c.code || c.pct) i.cartDiscount = c;
  } else if (i.cartDiscount === undefined && (ctx.cartDiscountCode || ctx.cartDiscountPct)) i.cartDiscount = { code: ctx.cartDiscountCode, pct: ctx.cartDiscountPct };
  // a new code only when it is bigger than what she already has — otherwise we just remind her of hers
  if (i.pct > 0 && (i.cartDiscount?.pct ?? 0) >= i.pct) i.pct = 0;
  let code = "", endsAt: Date | null = null;
  if (i.pct > 0) {
    if (i.preview) { code = `GIFT${i.pct}-XXXXX`; endsAt = new Date(Date.now() + i.validHours * 3_600_000); }
    else {
      const hours = i.validUntil ? Math.max(3, (+i.validUntil - Date.now()) / 3_600_000) : i.validHours;
      ({ code, endsAt } = await createDiscount(i.admin, i.pct, hours, i.kind, !!i.settings.combineDiscounts));
    }
  }
  let url = i.preview ? `https://${ctx.host || i.shopDomain}/cart` : await recoveryUrl(i.admin, ctx, i.shopDomain);
  if (code) {
    url = withDiscountLink(url, code);
  }
  // the cart already had a code (pop-up …): keep it applied when she comes back
  if (!code && i.cartDiscount?.code && !i.preview) url = withDiscountLink(url, i.cartDiscount.code);
  const dateFmt = locale === "ro" ? "ro-RO" : locale === "pl" ? "pl-PL" : "de-DE";
  const vars: Record<string, string> = {
    first_name: ctx.firstName || (locale === "de" ? "" : locale === "pl" ? "" : ""),
    // prices as she will pay them: the full price struck through + the price after her discount (the new code, or the one in her cart)
    ...productVars(tpl.design, ctx.items.map((it) => {
      const p = typeof it.price === "number" ? it.price : null;
      const off = code ? i.pct : i.cartDiscount?.pct ?? 0;
      if (p != null && off > 0) return { ...it, oldPrice: money(p, ctx.currency, locale), price: money(Math.round(p * (100 - off)) / 100, ctx.currency, locale) };
      return { ...it, price: p != null ? money(p, ctx.currency, locale) : (it.price as any) ?? null };
    }), brandOf(i.settings, "")),
    total: money(ctx.total, ctx.currency, locale),
    recovery_url: url,
    discount_code: code,
    discount_pct: i.pct ? String(i.pct) : "",
    valid_until: endsAt ? endsAt.toLocaleString(dateFmt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: locale === "ro" ? "Europe/Bucharest" : locale === "pl" ? "Europe/Warsaw" : "Europe/Berlin" }) : "",
    shop_name: "",
    cart_discount_pct: !code && i.cartDiscount?.pct ? String(Math.round(i.cartDiscount.pct)) : "",
    cart_discount_code: !code && i.cartDiscount?.code ? i.cartDiscount.code : "",
  };
  const ident = await shopIdentity(i.admin);
  vars.shop_name = i.settings.fromName || ident.name;
  Object.assign(vars, unsubVars(locale, vars.shop_name));
  const out = render(templateSource(tpl as any, brandOf(i.settings, ident.name)), vars, !!code);
  // greeting without a name: "Hallo ," → "Hallo,"
  out.html = out.html.replace(/(Hallo|Cześć|Bună),? ,/g, "$1,").replace(/(Hallo|Cześć|Bună) ,/g, "$1,");
  if (i.preview) return { ...out, to: ctx.email, code, url };

  try {
    const sentToday = await db.emailSend.count({ where: { shopId: i.shopId, status: "sent", createdAt: { gt: new Date(Date.now() - DAY) } } });
    if (sentToday >= DAILY_LIMIT) throw new Error(`Limita zilnică de ${DAILY_LIMIT} e-mailuri a fost atinsă.`);
    const uurl = unsubUrl(i.shopId, ctx.email);
    const html = withUnsubFooter(out.html.split(UNSUB_PH).join(uurl), uurl, locale, vars.shop_name);
    const providerId = await sendMail({ to: ctx.email, subject: out.subject, html, fromName: i.settings.fromName || ident.name, fromEmail: await senderOf(i.shopDomain, i.settings), replyTo: i.settings.replyTo || ident.email || undefined, unsubscribeUrl: uurl });
    await db.emailSend.create({ data: { shopId: i.shopId, deviceId: i.deviceId, checkoutToken: ctx.checkoutToken, email: ctx.email, templateId: tpl.id, subject: out.subject, kind: i.kind, discountCode: code || null, discountPct: i.pct || null, status: "sent", providerId, html } });
  } catch (e: any) {
    await db.emailSend.create({ data: { shopId: i.shopId, deviceId: i.deviceId, checkoutToken: ctx.checkoutToken, email: ctx.email, templateId: tpl.id, subject: out.subject, kind: i.kind, discountCode: code || null, discountPct: i.pct || null, status: "failed", error: String(e?.message || e).slice(0, 500) } });
    throw e;
  }
  return { ...out, to: ctx.email, code, url };
}

async function pickTemplate(shopId: string, purpose: "auto1" | "auto2" | "auto3", locale: string) {
  return (await db.emailTemplate.findFirst({ where: { shopId, purpose, locale }, orderBy: { updatedAt: "desc" } }))
    ?? (await db.emailTemplate.findFirst({ where: { shopId, purpose, locale: "en" }, orderBy: { updatedAt: "desc" } }))
    ?? (await db.emailTemplate.findFirst({ where: { shopId, purpose, locale: "de" }, orderBy: { updatedAt: "desc" } }));
}

/** Buyer's time zone from the checkout country / language / store domain. */
export function tzOf(x: { country?: string | null; locale?: string | null; host?: string | null }) {
  const c = (x.country || "").toUpperCase();
  const map: Record<string, string> = { RO: "Europe/Bucharest", MD: "Europe/Chisinau", DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich", PL: "Europe/Warsaw", BG: "Europe/Sofia", ES: "Europe/Madrid", IT: "Europe/Rome", FR: "Europe/Paris", SE: "Europe/Stockholm", DK: "Europe/Copenhagen" };
  if (map[c]) return map[c];
  const l = (x.locale || "").slice(0, 2);
  if (l === "de" || (x.host || "").endsWith(".de")) return "Europe/Berlin";
  if (l === "pl" || (x.host || "").endsWith(".pl")) return "Europe/Warsaw";
  return "Europe/Bucharest";
}
/** Whole days between two local calendar days (YYYY-MM-DD). */
export function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
}
/** 23:59 of today in the buyer's time zone. */
export function endOfLocalDay(now: Date, tz: string) {
  const { hour } = localParts(now, tz);
  const mins = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, minute: "2-digit" }).format(now)) || 0;
  return new Date(+now + ((23 - hour) * 60 + (59 - mins)) * 60_000);
}
/** Local calendar day (YYYY-MM-DD) and hour of a moment in a time zone. */
export function localParts(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/**
 * One pass of the automatic reminders for one shop.
 *  1st e-mail: delay1Min after the last checkout step, only the same day (within 12 h) and not at night (22–8 local).
 *  2nd e-mail ("morning", default): the next morning between morningHour and morningHour+4, buyer's local time,
 *     to everyone who left a checkout on an earlier day (up to 3 days back) and has not ordered — also to those
 *     who got no 1st e-mail (night, or e-mail found later). With a discount when pct2 > 0.
 *  2nd e-mail ("delay"): delay2Hours after the 1st.
 */
export async function runAutomation(shop: { id: string; domain: string; settings: unknown; plan?: string | null }) {
  if (!can(planOf(shop), "recovery")) return { sent: 0 };
  const s = settingsOf(shop.settings).recovery;
  if (!s.enabled || !process.env.RESEND_API_KEY || !(MAIL_DOMAIN || s.fromEmail)) return { sent: 0 };
  const { admin } = await unauthenticated.admin(shop.domain);
  await enrichFromShopify(admin as any, shop.id).catch((e) => console.error("[semafor] enrich", e?.message || e));
  const since = new Date(Date.now() - 7 * DAY);
  const rows = (await db.checkoutAttempt.findMany({ where: { shopId: shop.id, createdAt: { gt: since } }, select: { deviceId: true, event: true, email: true, createdAt: true, country: true, locale: true, host: true }, orderBy: { createdAt: "asc" } })) as any[];
  type D = { email: string | null; first: Date; last: Date; done: boolean; country: string | null; locale: string | null; host: string | null };
  const devs = new Map<string, D>();
  const completedEmails = new Set<string>();
  for (const r of rows) {
    const d: D = devs.get(r.deviceId) ?? { email: null, first: r.createdAt, last: r.createdAt, done: false, country: null, locale: null, host: null };
    d.last = r.createdAt; if (r.email) d.email = r.email; if (r.country) d.country = r.country; if (r.locale) d.locale = r.locale; if (r.host) d.host = r.host;
    if (r.event === "completed") { d.done = true; if (r.email) completedEmails.add(r.email.toLowerCase()); }
    devs.set(r.deviceId, d);
  }
  const now = new Date();
  const morningMode = s.secondMode !== "delay";
  const mh = Math.min(20, Math.max(6, Number(s.morningHour) || 10));
  let sent = 0;
  const seen = new Set<string>();
  for (const [deviceId, d] of devs) {
    if (sent >= 20) break; // gentle: max 20 e-mails per pass (the scheduler runs every 5 minutes)
    if (d.done || !d.email || completedEmails.has(d.email.toLowerCase())) continue;
    const em = d.email.toLowerCase();
    if (seen.has(em)) continue; // one buyer on several devices → one e-mail
    seen.add(em);
    if (await isOptedOut(shop.id, em)) continue;
    const prev = (await db.emailSend.findMany({ where: { shopId: shop.id, email: d.email, createdAt: { gt: since } }, orderBy: { createdAt: "asc" } })) as any[];
    if (prev.some((p) => p.status === "skipped" && (p.error === "a comandat între timp" || p.error === "fără produse în coș"))) continue;
    const has = (k: string) => prev.some((p) => p.kind === k && p.status === "sent");
    const failed = (k: string) => prev.filter((p) => p.kind === k && p.status === "failed").length;
    const lastSent = prev.filter((p) => p.status === "sent").pop();
    const tz = tzOf(d);
    const loc = localParts(now, tz);
    const age = +now - +d.last;
    let kind: "auto1" | "auto2" | "auto3" | null = null;
    const abandonDay = localParts(d.last, tz).day;
    const daysSince = dayDiff(abandonDay, loc.day); // 0 = same local day, 1 = next day …
    const restedSinceLast = !lastSent || +now - +lastSent.createdAt >= 6 * 3_600_000;

    // 1st: ~1 hour after leaving the checkout, not at night — plain reminder, no discount
    if (!has("auto1") && !has("manual") && !has("auto2") && !has("auto3")) {
      const night = loc.hour < 8 || loc.hour >= 22;
      if (age >= s.delay1Min * 60_000 && age < 12 * 3_600_000 && !night && failed("auto1") < 3) kind = "auto1";
    }
    // 2nd: next day at the chosen local hour — urgency + (cart discount reminder | our discount)
    if (!kind && s.second && !has("auto2") && !has("auto3")) {
      if (morningMode) {
        const inWindow = loc.hour >= mh && loc.hour < mh + 4;
        if (daysSince >= 1 && daysSince <= 2 && inWindow && restedSinceLast && failed("auto2") < 3) kind = "auto2";
      } else if (has("auto1")) {
        const first = prev.find((p) => p.kind === "auto1" && p.status === "sent");
        if (first && +now - +first.createdAt >= s.delay2Hours * 3_600_000 && failed("auto2") < 3) kind = "auto2";
      }
    }
    // 3rd: the day after the 2nd e-mail — last chance, bigger discount valid only today
    if (!kind && s.third && has("auto2") && !has("auto3")) {
      const second = prev.filter((p) => p.kind === "auto2" && p.status === "sent").pop();
      const h3 = Math.min(21, Math.max(6, Number(s.thirdHour) || 12));
      const inWindow = loc.hour >= h3 && loc.hour < h3 + 4;
      const nextDayAfterSecond = second && dayDiff(localParts(second.createdAt, tz).day, loc.day) >= 1;
      if (nextDayAfterSecond && daysSince <= 4 && inWindow && restedSinceLast && failed("auto3") < 3) kind = "auto3";
    }
    if (!kind) continue;
    if (await orderedSince(admin as any, d.email, d.first)) { await db.emailSend.create({ data: { shopId: shop.id, deviceId, email: d.email, subject: "-", kind, status: "skipped", error: "a comandat între timp" } }); continue; }
    if (s.onlyConsent) {
      const ctx = await deviceContext(shop.id, deviceId);
      const c = await consentOf(admin as any, d.email);
      if (!(ctx?.acceptsMarketing || c === "SUBSCRIBED")) {
        if (!prev.some((p) => p.kind === kind && p.status === "skipped")) await db.emailSend.create({ data: { shopId: shop.id, deviceId, email: d.email, subject: "-", kind, status: "skipped", error: "fără acord de marketing" } });
        continue;
      }
    }
    const ctx = await deviceContext(shop.id, deviceId);
    if (!ctx) continue;
    const tpl = await pickTemplate(shop.id, kind, localeOf(ctx));
    if (!tpl) continue;
    // the discount already in her cart (pop-up code …) is always taken into account — also in e-mail 1 (price + reminder)
    const cart = await cartDiscountOf(admin as any, ctx);
    const hasCartDiscount = !!(cart.code || cart.pct);
    // 2nd: if the cart already has a discount we only remind about it; otherwise we give ours (pct2)
    // 3rd: the final, bigger discount (pct3) — unless what she already has is as big
    const pct = kind === "auto2" ? (hasCartDiscount ? 0 : s.pct2) : kind === "auto3" ? ((cart.pct ?? 0) >= s.pct3 ? 0 : s.pct3) : 0;
    try {
      await sendRecovery({
        shopId: shop.id, shopDomain: shop.domain, admin: admin as any, deviceId, templateId: tpl.id, pct, validHours: s.validHours2, kind, settings: s,
        cartDiscount: hasCartDiscount ? cart : undefined,
        validUntil: kind === "auto3" ? endOfLocalDay(now, tz) : undefined,
      });
      sent++;
    } catch (e: any) {
      if (e?.message === "NO_ITEMS") await db.emailSend.create({ data: { shopId: shop.id, deviceId, email: d.email, subject: "-", kind, status: "skipped", error: "fără produse în coș" } });
      else console.error("[semafor] recovery send failed", e?.message || e);
    }
  }
  return { sent };
}

/** Every 5 minutes, for every installed shop with automation on. Started once per server process. */
/**
 * One-off "first e-mail" to everybody who left the checkout in the last `days` days, never ordered and never got
 * a Semafor e-mail yet (each in the language of her checkout). dryRun = only count.
 */
export async function blastFirst(shop: { id: string; domain: string; settings: unknown }, opts: { days: number; dryRun: boolean }) {
  const s = settingsOf(shop.settings).recovery;
  const { admin } = await unauthenticated.admin(shop.domain);
  await enrichFromShopify(admin as any, shop.id, opts.days).catch(() => 0);
  const since = new Date(Date.now() - opts.days * DAY);
  const rows = (await db.checkoutAttempt.findMany({ where: { shopId: shop.id, createdAt: { gt: since } }, select: { deviceId: true, event: true, email: true, createdAt: true }, orderBy: { createdAt: "asc" } })) as any[];
  const devs = new Map<string, { email: string | null; first: Date; done: boolean }>();
  const completed = new Set<string>();
  for (const r of rows) {
    const d = devs.get(r.deviceId) ?? { email: null, first: r.createdAt, done: false };
    if (r.email) d.email = r.email;
    if (r.event === "completed") { d.done = true; if (r.email) completed.add(r.email.toLowerCase()); }
    devs.set(r.deviceId, d);
  }
  const res = { candidates: 0, sent: 0, ordered: 0, noConsent: 0, optedOut: 0, already: 0, failed: 0, noItems: 0, byLang: {} as Record<string, number> };
  const seen = new Set<string>();
  for (const [deviceId, d] of devs) {
    if (!d.email || d.done) continue;
    const em = d.email.toLowerCase();
    if (completed.has(em) || seen.has(em)) continue;
    seen.add(em);
    if (await isOptedOut(shop.id, em)) { res.optedOut++; continue; }
    if (await db.emailSend.count({ where: { shopId: shop.id, email: { equals: d.email, mode: "insensitive" }, status: "sent" } })) { res.already++; continue; }
    if (await orderedSince(admin as any, d.email, d.first)) { res.ordered++; continue; }
    const ctx = await deviceContext(shop.id, deviceId);
    if (!ctx) continue;
    if (s.onlyConsent) {
      const c = await consentOf(admin as any, d.email);
      if (!(ctx.acceptsMarketing || c === "SUBSCRIBED")) { res.noConsent++; continue; }
    }
    const lang = localeOf(ctx);
    res.candidates++;
    res.byLang[lang] = (res.byLang[lang] || 0) + 1;
    if (opts.dryRun) continue;
    const tpl = await pickTemplate(shop.id, "auto1", lang);
    if (!tpl) { res.failed++; continue; }
    try {
      await sendRecovery({ shopId: shop.id, shopDomain: shop.domain, admin: admin as any, deviceId, templateId: tpl.id, pct: 0, validHours: 24, kind: "auto1", settings: s });
      res.sent++;
    } catch (e: any) { if (e?.message === "NO_ITEMS") res.noItems = (res.noItems || 0) + 1; else { res.failed++; console.error("[semafor] blast", e?.message || e); } }
    await new Promise((r) => setTimeout(r, 700)); // stay well under the provider's rate limit
  }
  return res;
}

export function startRecoveryScheduler() {
  const g = globalThis as any;
  if (g.__semaforRecovery) return;
  g.__semaforRecovery = setInterval(async () => {
    try {
      const shops = (await db.shop.findMany({ where: { uninstalledAt: null }, select: { id: true, domain: true, settings: true, plan: true } })) as any[];
      const { sessionStorage } = await import("../shopify.server");
      for (const sh of shops) {
        // only shops installed in THIS app (two deployments share the database)
        try { const ss = await (sessionStorage as any).findSessionsByShop(sh.domain); if (!ss?.some((x: any) => !x.isOnline)) continue; } catch { continue; }
        try { await runAutomation(sh); } catch (e: any) { console.error("[semafor] recovery", sh.domain, e?.message || e); }
      }
    } catch (e: any) { console.error("[semafor] recovery scheduler", e?.message || e); }
  }, 5 * 60_000);
}
