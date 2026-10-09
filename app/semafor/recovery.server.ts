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
    items: (withItems?.items ?? []) as { title: string; qty: number; image?: string | null }[],
    acceptsMarketing: last("acceptsMarketing") as boolean | null,
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

/** True when this e-mail already has an order placed after `since`. */
export async function orderedSince(admin: Admin, email: string, since: Date): Promise<boolean> {
  try {
    const d = await gql(admin, `query($q:String!){ orders(first:1, query:$q){ nodes{ id } } }`, { q: `email:${JSON.stringify(email)} created_at:>=${since.toISOString()}` });
    return (d?.orders?.nodes?.length ?? 0) > 0;
  } catch { return false; }
}

/** The buyer's own checkout (Shopify abandoned-checkout recovery URL), moved to the store domain she used. */
export async function recoveryUrl(admin: Admin, ctx: DeviceCtx, shopDomain: string): Promise<string> {
  const host = ctx.host || null;
  let url: string | null = null;
  if (ctx.email) {
    try {
      const d = await gql(admin, `query($q:String!){ abandonedCheckouts(first:1, reverse:true, sortKey:CREATED_AT, query:$q){ nodes{ abandonedCheckoutUrl } } }`, { q: `email:${JSON.stringify(ctx.email)}` });
      url = d?.abandonedCheckouts?.nodes?.[0]?.abandonedCheckoutUrl ?? null;
    } catch { url = null; }
  }
  if (!url) return `https://${host || shopDomain}/cart`;
  if (!host) return url;
  try { const u = new URL(url); u.host = host; return u.toString(); } catch { return url; }
}

/** One-time percentage code valid for `hours`, for everything in the store. */
export async function createDiscount(admin: Admin, pct: number, hours: number, label: string) {
  const code = `MIA${pct}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const endsAt = new Date(Date.now() + hours * 3_600_000);
  const d = await gql(admin, `mutation($d: DiscountCodeBasicInput!){ discountCodeBasicCreate(basicCodeDiscount:$d){ codeDiscountNode{ id } userErrors{ field message } } }`, {
    d: {
      title: `Semafor ${label} ${code}`, code, startsAt: new Date().toISOString(), endsAt: endsAt.toISOString(),
      usageLimit: 1, appliesOncePerCustomer: true,
      context: { all: "ALL" },
      customerGets: { value: { percentage: pct / 100 }, items: { all: true } },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;border-top:1px solid #eee3d6">${items.map((i) => `<tr><td width="72" style="padding:10px 0;border-bottom:1px solid #eee3d6">${i.image ? `<img src="${esc(i.image)}" width="60" height="60" alt="" style="display:block;object-fit:cover;border:0">` : ""}</td><td style="padding:10px 0 10px 12px;border-bottom:1px solid #eee3d6;font-family:Arial,sans-serif;font-size:14px;color:#2a1a12">${esc(i.title)}${i.qty > 1 ? ` × ${i.qty}` : ""}</td></tr>`).join("")}</table>`;
}

export async function sendMail(m: { to: string; subject: string; html: string; fromName: string; fromEmail: string; replyTo?: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Lipsește RESEND_API_KEY în Railway (contul Resend pentru trimiterea e-mailurilor).");
  if (!m.fromEmail) throw new Error("Completează adresa expeditorului în E-mailuri → Setări.");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${m.fromName} <${m.fromEmail}>`, to: [m.to], subject: m.subject, html: m.html, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${j?.message || JSON.stringify(j).slice(0, 200)}`);
  return String(j?.id || "");
}

export type SendInput = { shopId: string; shopDomain: string; admin: Admin; deviceId: string; templateId: string; pct: number; validHours: number; kind: "manual" | "auto1" | "auto2"; preview?: boolean; settings: RecoverySettings };

/** Build (and unless preview, send) one recovery e-mail. Returns the rendered e-mail. */
export async function sendRecovery(i: SendInput) {
  const ctx = await deviceContext(i.shopId, i.deviceId);
  if (!ctx) throw new Error("Client necunoscut");
  if (!ctx.email) throw new Error("Clientul nu a introdus un e-mail.");
  const tpl = await db.emailTemplate.findFirst({ where: { id: i.templateId, shopId: i.shopId } });
  if (!tpl) throw new Error("Șablonul nu există.");
  const locale = tpl.locale || localeOf(ctx);
  let code = "", endsAt: Date | null = null;
  if (i.pct > 0) {
    if (i.preview) { code = `MIA${i.pct}-XXXXX`; endsAt = new Date(Date.now() + i.validHours * 3_600_000); }
    else ({ code, endsAt } = await createDiscount(i.admin, i.pct, i.validHours, i.kind));
  }
  let url = i.preview ? `https://${ctx.host || i.shopDomain}/cart` : await recoveryUrl(i.admin, ctx, i.shopDomain);
  if (code) {
    try { const u = new URL(url); url = `${u.origin}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(u.pathname + u.search)}`; } catch {}
  }
  const dateFmt = locale === "ro" ? "ro-RO" : locale === "pl" ? "pl-PL" : "de-DE";
  const vars: Record<string, string> = {
    first_name: ctx.firstName || (locale === "de" ? "" : locale === "pl" ? "" : ""),
    items: itemsHtml(ctx.items),
    total: money(ctx.total, ctx.currency, locale),
    recovery_url: url,
    discount_code: code,
    discount_pct: i.pct ? String(i.pct) : "",
    valid_until: endsAt ? endsAt.toLocaleString(dateFmt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: locale === "ro" ? "Europe/Bucharest" : locale === "pl" ? "Europe/Warsaw" : "Europe/Berlin" }) : "",
    shop_name: "MIA by MIHAILIUC",
  };
  const out = render(tpl, vars, !!code);
  // greeting without a name: "Hallo ," → "Hallo,"
  out.html = out.html.replace(/(Hallo|Cześć|Bună),? ,/g, "$1,").replace(/(Hallo|Cześć|Bună) ,/g, "$1,");
  if (i.preview) return { ...out, to: ctx.email, code, url };

  try {
    const providerId = await sendMail({ to: ctx.email, subject: out.subject, html: out.html, fromName: i.settings.fromName, fromEmail: i.settings.fromEmail, replyTo: i.settings.replyTo || undefined });
    await db.emailSend.create({ data: { shopId: i.shopId, deviceId: i.deviceId, checkoutToken: ctx.checkoutToken, email: ctx.email, templateId: tpl.id, subject: out.subject, kind: i.kind, discountCode: code || null, discountPct: i.pct || null, status: "sent", providerId } });
  } catch (e: any) {
    await db.emailSend.create({ data: { shopId: i.shopId, deviceId: i.deviceId, checkoutToken: ctx.checkoutToken, email: ctx.email, templateId: tpl.id, subject: out.subject, kind: i.kind, discountCode: code || null, discountPct: i.pct || null, status: "failed", error: String(e?.message || e).slice(0, 500) } });
    throw e;
  }
  return { ...out, to: ctx.email, code, url };
}

async function pickTemplate(shopId: string, purpose: "auto1" | "auto2", locale: string) {
  return (await db.emailTemplate.findFirst({ where: { shopId, purpose, locale }, orderBy: { updatedAt: "desc" } }))
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
  if (!s.enabled || !process.env.RESEND_API_KEY || !s.fromEmail) return { sent: 0 };
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
    const prev = (await db.emailSend.findMany({ where: { shopId: shop.id, email: d.email, createdAt: { gt: since } }, orderBy: { createdAt: "asc" } })) as any[];
    if (prev.some((p) => p.status === "skipped" && p.error === "a comandat între timp")) continue;
    const has = (k: string) => prev.some((p) => p.kind === k && p.status === "sent");
    const failed = (k: string) => prev.filter((p) => p.kind === k && p.status === "failed").length;
    const lastSent = prev.filter((p) => p.status === "sent").pop();
    const tz = tzOf(d);
    const loc = localParts(now, tz);
    const age = +now - +d.last;
    let kind: "auto1" | "auto2" | null = null;

    if (!has("auto1") && !has("manual") && !has("auto2")) {
      const night = loc.hour < 8 || loc.hour >= 22;
      if (age >= s.delay1Min * 60_000 && age < 12 * 3_600_000 && !night && failed("auto1") < 3) kind = "auto1";
    }
    if (!kind && s.second && !has("auto2")) {
      if (morningMode) {
        const abandonedEarlierDay = localParts(d.last, tz).day < loc.day;
        const inWindow = loc.hour >= mh && loc.hour < mh + 4;
        const restedSinceLast = !lastSent || +now - +lastSent.createdAt >= 6 * 3_600_000;
        if (abandonedEarlierDay && inWindow && age < 3 * DAY && restedSinceLast && failed("auto2") < 3) kind = "auto2";
      } else if (has("auto1")) {
        const first = prev.find((p) => p.kind === "auto1" && p.status === "sent");
        if (first && +now - +first.createdAt >= s.delay2Hours * 3_600_000 && failed("auto2") < 3) kind = "auto2";
      }
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
    try {
      await sendRecovery({ shopId: shop.id, shopDomain: shop.domain, admin: admin as any, deviceId, templateId: tpl.id, pct: kind === "auto2" ? s.pct2 : 0, validHours: s.validHours2, kind, settings: s });
      sent++;
    } catch (e: any) { console.error("[semafor] recovery send failed", e?.message || e); }
  }
  return { sent };
}

/** Every 5 minutes, for every installed shop with automation on. Started once per server process. */
export function startRecoveryScheduler() {
  const g = globalThis as any;
  if (g.__semaforRecovery) return;
  g.__semaforRecovery = setInterval(async () => {
    try {
      const shops = (await db.shop.findMany({ where: { uninstalledAt: null }, select: { id: true, domain: true, settings: true, plan: true } })) as any[];
      for (const sh of shops) {
        try { await runAutomation(sh); } catch (e: any) { console.error("[semafor] recovery", sh.domain, e?.message || e); }
      }
    } catch (e: any) { console.error("[semafor] recovery scheduler", e?.message || e); }
  }, 5 * 60_000);
}
