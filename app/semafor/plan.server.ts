import db from "../db.server";
import { can, normPlan, planFromSubscriptionName, FREE_MONTHLY_CHECKS, type Feature, type Plan } from "../../core/plans";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

/** Shops that always have Pro (the owner's own stores). Comma-separated myshopify domains. */
const OWNER_SHOPS = (process.env.SEMAFOR_PRO_SHOPS || "1nbnns-by.myshopify.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isOwnerShop(domain: string | null | undefined) {
  return OWNER_SHOPS.includes(String(domain || "").toLowerCase());
}

export function planOf(shop: { plan?: string | null; domain?: string | null } | null | undefined): Plan {
  if (!shop) return "free";
  if (isOwnerShop(shop.domain)) return "pro";
  return normPlan(shop.plan);
}

/** Read the active subscription from Shopify and store it on the Shop row. */
export async function refreshPlan(admin: Admin, shop: { id: string; domain: string; plan?: string | null }): Promise<Plan> {
  if (isOwnerShop(shop.domain)) {
    if (shop.plan !== "pro") await db.shop.update({ where: { id: shop.id }, data: { plan: "pro" } });
    return "pro";
  }
  try {
    const j: any = await (await admin.graphql(`#graphql
      query { currentAppInstallation { activeSubscriptions { name status } } }`)).json();
    const subs: any[] = j?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const active = subs.filter((s) => s.status === "ACTIVE");
    let plan: Plan = "free";
    for (const s of active) { const p = planFromSubscriptionName(s.name); if (p === "pro" || (p === "basic" && plan === "free")) plan = p; }
    if (plan !== shop.plan) await db.shop.update({ where: { id: shop.id }, data: { plan } });
    return plan;
  } catch (e) {
    console.error("[semafor] refreshPlan", e);
    return normPlan(shop.plan);
  }
}

/** Use in loaders/actions of paid pages: sends the merchant to the plans page when the feature is locked. */
/** `go` = the `redirect` helper returned by authenticate.admin (keeps the embedded-app params). */
export function requireFeature(shop: { plan?: string | null; domain?: string | null }, f: Feature, go: (url: string) => any) {
  if (!can(planOf(shop), f)) throw go(`/app/plan?need=${f}`);
}

function monthStart() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }

/** Orders checked this calendar month (for the Free limit). */
export async function checksThisMonth(shopId: string) {
  return db.orderCheck.count({ where: { shopId, checkedAt: { gte: monthStart() } } });
}

/** true when a new order may be checked under the shop's plan. */
export async function withinQuota(shop: { id: string; plan?: string | null; domain?: string | null }) {
  if (can(planOf(shop), "unlimited_checks")) return true;
  return (await checksThisMonth(shop.id)) < FREE_MONTHLY_CHECKS;
}
