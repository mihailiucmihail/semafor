import db from "../db.server";
import { can, normPlan, planFromSubscriptionName, FREE_MONTHLY_CHECKS, type Feature, type Plan } from "../../core/plans";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

/** Shops that always have Pro (the owner's own stores). Comma-separated myshopify domains. */
/** + the owner's development store used for the App Store review screencast (dev stores can't pick paid plans). */
const OWNER_SHOPS = ["1nbnns-by.myshopify.com", "mihailiuc-nyprysws.myshopify.com", ...(process.env.SEMAFOR_PRO_SHOPS || "").split(",")]
  .map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Public demo store (fictional brand, invented customers): always Pro, never writes to the shared network. */
const DEMO_SHOPS = ["semafor-review-test.myshopify.com", ...(process.env.SEMAFOR_DEMO_SHOPS || "").split(",")]
  .map((s) => s.trim().toLowerCase()).filter(Boolean);
export function isDemoShop(domain: string | null | undefined) {
  return DEMO_SHOPS.includes(String(domain || "").toLowerCase());
}

export function isOwnerShop(domain: string | null | undefined) {
  return OWNER_SHOPS.includes(String(domain || "").toLowerCase());
}

type PlanShop = { plan?: string | null; domain?: string | null; trialEndsAt?: Date | string | null };

/** The free Pro trial of a store on Free: active, whole days left (rounded up), end date. */
export function trialOf(shop: PlanShop | null | undefined) {
  const end = shop?.trialEndsAt ? new Date(shop.trialEndsAt) : null;
  const paid = normPlan(shop?.plan) !== "free" || isOwnerShop(shop?.domain) || isDemoShop(shop?.domain);
  const active = !!end && !paid && end.getTime() > Date.now();
  const daysLeft = end ? Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000)) : 0;
  return { active, daysLeft, endsAt: end, ended: !!end && !paid && !active };
}

export function planOf(shop: PlanShop | null | undefined): Plan {
  if (!shop) return "free";
  if (isOwnerShop(shop.domain) || isDemoShop(shop.domain)) return "pro";
  const p = normPlan(shop.plan);
  if (p === "free" && trialOf(shop).active) return "pro";
  return p;
}

/** After a plan change (subscription webhook, end of the trial): re-writes what the storefront and checkout read,
 *  so features of a plan the store no longer has stop working right away. */
export async function applyPlanChange(domain: string) {
  try {
    const { unauthenticated } = await import("../shopify.server");
    const { getShop } = await import("./shop.server");
    const { pushCheckoutMetafield } = await import("./entries.server");
    const { pushPopupConfig } = await import("./popup.server");
    const shop = await getShop(domain);
    if (!shop || shop.uninstalledAt) return;
    const { admin } = await unauthenticated.admin(domain);
    await pushCheckoutMetafield(admin as any, shop.id).catch((e: any) => console.error("[semafor] plan change checkout", domain, e?.message || e));
    await pushPopupConfig(admin as any, shop as any).catch((e: any) => console.error("[semafor] plan change popup", domain, e?.message || e));
  } catch (e: any) { console.error("[semafor] applyPlanChange", domain, e?.message || e); }
}

/** Read the active subscription from Shopify and store it on the Shop row. */
export async function refreshPlan(admin: Admin, shop: { id: string; domain: string; plan?: string | null }): Promise<Plan> {
  if (isOwnerShop(shop.domain) || isDemoShop(shop.domain)) {
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
export function requireFeature(shop: PlanShop, f: Feature, go: (url: string) => any) {
  if (!can(planOf(shop), f)) throw go(`/app/plan?need=${f}`);
}

function monthStart() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }

/** Orders checked this calendar month (for the Free limit). */
export async function checksThisMonth(shopId: string) {
  return db.orderCheck.count({ where: { shopId, checkedAt: { gte: monthStart() } } });
}

/** true when a new order may be checked under the shop's plan. */
export async function withinQuota(shop: { id: string; plan?: string | null; domain?: string | null; trialEndsAt?: Date | string | null }) {
  if (can(planOf(shop), "unlimited_checks")) return true;
  return (await checksThisMonth(shop.id)) < FREE_MONTHLY_CHECKS;
}

/** Banner data for the free Pro trial (overview + plans page): null when the store has no trial to talk about. */
export async function trialBanner(shop: { id: string; country: string; plan?: string | null; domain?: string | null; trialEndsAt?: Date | null; installedAt?: Date | null }) {
  const t = trialOf(shop);
  if (!t.endsAt || isOwnerShop(shop.domain)) return null;
  if (!t.active && !t.ended) return null;
  // the "trial ended" note stays for 14 days, then the normal Free screens are enough
  if (t.ended && Date.now() - t.endsAt.getTime() > 14 * 86_400_000) return null;
  const since = shop.installedAt ?? new Date(t.endsAt.getTime() - 14 * 86_400_000);
  const until = t.ended ? t.endsAt : new Date();
  const range = { gte: since, lte: until };
  const { blockedSummary } = await import("./blocked.server");
  const [checked, risky, sent, blocked] = await Promise.all([
    db.orderCheck.count({ where: { shopId: shop.id, checkedAt: range } }),
    db.orderCheck.count({ where: { shopId: shop.id, checkedAt: range, OR: [{ level: { not: "green" } }, { networkLevel: { not: "green" } }] } }),
    db.emailSend.count({ where: { shopId: shop.id, status: "sent", createdAt: range } }),
    blockedSummary(shop, since).then((b) => b.stopped).catch(() => 0),
  ]);
  return { active: t.active, daysLeft: t.daysLeft, endsAt: t.endsAt.toISOString(), checked, risky, sent, blocked };
}
