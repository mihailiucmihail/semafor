/**
 * Storefront pop-up (theme app embed "Semafor pop-up"):
 *  - pushes the merchant's settings into the app-data metafield the embed reads (app.metafields.semafor.popup),
 *  - handles a subscription from the app proxy: Shopify customer with e-mail marketing consent + PopupLead row
 *    (links the browser id the pixel uses to the e-mail, so later carts / checkouts without an e-mail can be recovered),
 *  - small stats for the admin page.
 */
import db from "../db.server";
import { can } from "../../core/plans";
import { buildPopupConfig, autoCode } from "../../core/popup";
import type { PopupSettings, ShopSettings } from "../../core/settings";
import { planOf } from "./plan.server";
import { isOptedOut } from "./recovery.server";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };
const DAY = 86_400_000;

async function gql(admin: Admin, q: string, variables?: any) {
  const r = await admin.graphql(q, variables ? { variables } : undefined);
  const j: any = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/** Pop-up allowed by the plan (Basic and Pro; the owner's stores are always Pro). */
export function popupAllowed(shop: { plan?: string | null; domain?: string | null }) {
  return can(planOf(shop), "popup");
}

/** Writes the storefront config into the app-data metafield (AppInstallation, namespace semafor, key popup). */
export async function pushPopupConfig(admin: Admin, shop: { plan?: string | null; domain?: string | null; settings: ShopSettings }) {
  const d = await gql(admin, `query { currentAppInstallation { id } shop { name } }`);
  const ownerId = d?.currentAppInstallation?.id;
  if (!ownerId) throw new Error("no app installation");
  const p: PopupSettings = { ...shop.settings.popup, enabled: shop.settings.popup.enabled && popupAllowed(shop) };
  const value = JSON.stringify(buildPopupConfig(p, d?.shop?.name || ""));
  const r = await gql(admin, `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ metafields{ id } userErrors{ field message } } }`,
    { m: [{ ownerId, namespace: "semafor", key: "popup", type: "json", value }] });
  const errs = r?.metafieldsSet?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e: any) => e.message).join("; "));
  return { ok: true };
}

export type CodeCheck = { exists: boolean; title?: string | null; status?: string | null; pct?: number | null; error?: string };
/** Does the discount code exist in Shopify (and is it active)? */
export async function checkDiscountCode(admin: Admin, code: string): Promise<CodeCheck> {
  if (!code) return { exists: false };
  try {
    const d = await gql(admin, `query($code:String!){ codeDiscountNodeByCode(code:$code){ id codeDiscount{ __typename
      ... on DiscountCodeBasic { title status customerGets{ value{ __typename ... on DiscountPercentage { percentage } } } }
      ... on DiscountCodeBxgy { title status } ... on DiscountCodeFreeShipping { title status } ... on DiscountCodeApp { title status } } } }`, { code });
    const n = d?.codeDiscountNodeByCode;
    if (!n) return { exists: false };
    const c = n.codeDiscount || {};
    const pct = c.customerGets?.value?.percentage;
    return { exists: true, title: c.title ?? null, status: c.status ?? null, pct: typeof pct === "number" ? Math.round(pct * 100) : null };
  } catch (e: any) {
    return { exists: false, error: String(e?.message || e).slice(0, 200) };
  }
}

/**
 * Auto mode: makes sure Shopify has the pop-up code for `pct` — WELCOME<pct>, a basic code discount,
 * pct % off the whole order, once per customer, no end date, combinable only with shipping discounts.
 * A code Semafor created earlier is updated (percentage, re-activated); a merchant's own code with the same name is
 * reused only when it already gives the same active percentage, otherwise a variant name is used.
 */
export async function ensurePopupDiscount(admin: Admin, pct: number): Promise<{ code: string; action: "created" | "updated" | "reused" }> {
  const base = autoCode(pct);
  const title = `Semafor pop-up ${pct}%`;
  const gets = { value: { percentage: pct / 100 }, items: { all: true } };
  for (const code of [base, `${base}S`, `${base}-SMF`]) {
    const d = await gql(admin, `query($code:String!){ codeDiscountNodeByCode(code:$code){ id codeDiscount{ __typename
      ... on DiscountCodeBasic { title status customerGets{ value{ __typename ... on DiscountPercentage { percentage } } } } } } }`, { code });
    const n = d?.codeDiscountNodeByCode;
    if (!n) {
      const r = await gql(admin, `mutation($d: DiscountCodeBasicInput!){ discountCodeBasicCreate(basicCodeDiscount:$d){ codeDiscountNode{ id } userErrors{ field message } } }`, {
        d: { title, code, startsAt: new Date().toISOString(), endsAt: null, appliesOncePerCustomer: true, context: { all: "ALL" }, customerGets: gets,
          combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true } },
      });
      const errs = r?.discountCodeBasicCreate?.userErrors ?? [];
      if (errs.length) throw new Error(errs.map((e: any) => e.message).join("; "));
      return { code, action: "created" };
    }
    const c = n.codeDiscount || {};
    const have = typeof c.customerGets?.value?.percentage === "number" ? Math.round(c.customerGets.value.percentage * 100) : null;
    if (c.__typename === "DiscountCodeBasic" && String(c.title || "").startsWith("Semafor pop-up")) {
      if (have !== pct || c.status !== "ACTIVE") {
        const r = await gql(admin, `mutation($id: ID!, $d: DiscountCodeBasicInput!){ discountCodeBasicUpdate(id:$id, basicCodeDiscount:$d){ codeDiscountNode{ id } userErrors{ field message } } }`, {
          id: n.id, d: { title, customerGets: gets, endsAt: null, appliesOncePerCustomer: true, ...(c.status !== "ACTIVE" ? { startsAt: new Date().toISOString() } : {}) },
        });
        const errs = r?.discountCodeBasicUpdate?.userErrors ?? [];
        if (errs.length) throw new Error(errs.map((e: any) => e.message).join("; "));
        return { code, action: "updated" };
      }
      return { code, action: "reused" };
    }
    if (have === pct && c.status === "ACTIVE") return { code, action: "reused" };
  }
  throw new Error(`code ${base} is taken`);
}

/** Latest pop-up e-mail of a browser (device id shared with the pixel). */
export async function popupLeadFor(shopId: string, deviceId: string) {
  return db.popupLead.findFirst({ where: { shopId, deviceId }, orderBy: { createdAt: "desc" }, select: { email: true, createdAt: true, source: true, locale: true } });
}

/** Device id → latest pop-up e-mail, for many devices at once. */
export async function popupLeadMap(shopId: string, deviceIds?: string[]) {
  const rows = (await db.popupLead.findMany({
    where: { shopId, ...(deviceIds ? { deviceId: { in: deviceIds } } : {}) },
    orderBy: { createdAt: "asc" }, select: { deviceId: true, email: true, createdAt: true, locale: true, source: true },
  })) as Array<{ deviceId: string; email: string; createdAt: Date; locale: string | null; source: string }>;
  const m = new Map<string, { email: string; createdAt: Date; locale: string | null; source: string }>();
  for (const r of rows) m.set(r.deviceId, { email: r.email, createdAt: r.createdAt, locale: r.locale, source: r.source });
  return m;
}

/** true when this browser is already linked to an e-mail (pop-up or checkout). */
export async function deviceKnown(shopId: string, deviceId: string) {
  if (await db.popupLead.count({ where: { shopId, deviceId } })) return true;
  return (await db.checkoutAttempt.count({ where: { shopId, deviceId, email: { not: null } } })) > 0;
}

const seenAt = new Map<string, number>();
/** The embed pinged us: remember when (atomic JSON update, at most every 30 min per shop and process). */
export async function markEmbedSeen(shopId: string) {
  const last = seenAt.get(shopId) ?? 0;
  if (Date.now() - last < 30 * 60_000) return;
  seenAt.set(shopId, Date.now());
  await db.$executeRaw`UPDATE "Shop" SET "settings" = jsonb_set(COALESCE("settings", '{}'::jsonb), '{popupSeenAt}', to_jsonb(${new Date().toISOString()}::text)) WHERE "id" = ${shopId}`;
}

export type LeadInput = { email: string; deviceId: string; source: "site" | "cart"; locale: string | null; pageUrl: string | null };

/**
 * A visitor subscribed in the pop-up:
 *  - finds / creates the Shopify customer; new ones get e-mail marketing consent SUBSCRIBED (single opt-in) and the
 *    tags newsletter, semafor-popup, <code>; existing ones get consent only when they never unsubscribed,
 *  - stores the PopupLead (device ↔ e-mail).
 * Shopify errors never block the visitor: the lead is saved and the code returned anyway.
 */
export async function subscribeLead(admin: Admin | null, shop: { id: string; settings: ShopSettings }, i: LeadInput) {
  const email = i.email.trim().toLowerCase();
  const code = shop.settings.popup.code;
  let customerId: string | null = null;
  if (admin) {
    try {
      const tags = ["newsletter", "semafor-popup", code].filter(Boolean);
      const now = new Date().toISOString();
      const d = await gql(admin, `query($q:String!){ customers(first:1, query:$q){ nodes{ id emailMarketingConsent{ marketingState } } } }`, { q: `email:${JSON.stringify(email)}` });
      const c = d?.customers?.nodes?.[0];
      if (!c) {
        const r = await gql(admin, `mutation($input: CustomerInput!){ customerCreate(input:$input){ customer{ id } userErrors{ field message } } }`,
          { input: { email, tags, emailMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN", consentUpdatedAt: now } } });
        const errs = r?.customerCreate?.userErrors ?? [];
        if (errs.length) console.error("[semafor] popup customerCreate", errs);
        customerId = r?.customerCreate?.customer?.id ?? null;
      } else {
        customerId = c.id;
        const st = c.emailMarketingConsent?.marketingState ?? null;
        // respect an explicit unsubscribe (in Shopify or from a Semafor e-mail)
        if (st !== "SUBSCRIBED" && st !== "UNSUBSCRIBED" && !(await isOptedOut(shop.id, email))) {
          const r = await gql(admin, `mutation($input: CustomerEmailMarketingConsentUpdateInput!){ customerEmailMarketingConsentUpdate(input:$input){ customer{ id } userErrors{ field message } } }`,
            { input: { customerId: c.id, emailMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN", consentUpdatedAt: now } } });
          const errs = r?.customerEmailMarketingConsentUpdate?.userErrors ?? [];
          if (errs.length) console.error("[semafor] popup consent", errs);
        }
        await gql(admin, `mutation($id: ID!, $tags: [String!]!){ tagsAdd(id:$id, tags:$tags){ userErrors{ field message } } }`, { id: c.id, tags }).catch((e) => console.error("[semafor] popup tagsAdd", e?.message || e));
      }
    } catch (e: any) {
      console.error("[semafor] popup customer", e?.message || e);
    }
  }
  const have = await db.popupLead.findFirst({ where: { shopId: shop.id, deviceId: i.deviceId, email }, select: { id: true } });
  if (!have) {
    await db.popupLead.create({ data: { shopId: shop.id, deviceId: i.deviceId, email, source: i.source, locale: i.locale, pageUrl: i.pageUrl, customerId } });
  } else if (customerId) {
    await db.popupLead.update({ where: { id: have.id }, data: { customerId } });
  }
  return { code };
}

/** Leads of the last `days` days, how many of them came back to the cart / checkout, and how many ordered. */
export async function popupStats(shopId: string, days = 30) {
  const since = new Date(Date.now() - days * DAY);
  const leads = (await db.popupLead.findMany({ where: { shopId, createdAt: { gt: since } }, select: { deviceId: true, email: true, createdAt: true } })) as Array<{ deviceId: string; email: string; createdAt: Date }>;
  if (!leads.length) return { leads: 0, cart: 0, ordered: 0 };
  const devs = [...new Set(leads.map((l) => l.deviceId))];
  const rows = (await db.checkoutAttempt.findMany({ where: { shopId, createdAt: { gt: since }, OR: [{ deviceId: { in: devs } }, { event: "completed" }] }, select: { deviceId: true, event: true, email: true, createdAt: true } })) as Array<{ deviceId: string; event: string; email: string | null; createdAt: Date }>;
  let cart = 0, ordered = 0;
  for (const l of leads) {
    const after = rows.filter((r) => +r.createdAt >= +l.createdAt - 3_600_000 && (r.deviceId === l.deviceId || (r.event === "completed" && r.email?.toLowerCase() === l.email)));
    if (after.some((r) => r.deviceId === l.deviceId)) cart++;
    if (after.some((r) => r.event === "completed")) ordered++;
  }
  return { leads: leads.length, cart, ordered };
}
