// When Semafor may ask Shopify to show its review modal (App Bridge shopify.reviews.request()).
// Policy (Shopify App Store requirement 1.3): only the neutral Shopify modal, never "leave 5 stars",
// never any reward. We ask once the merchant has actually seen Semafor work, not on the first visit.
import db from "../db.server";
import { saveSettings } from "./shop.server";
import { isOwnerShop } from "./plan.server";

const DAY = 86_400_000;
/** Days after install before the first ask — the merchant needs time to see real orders checked. */
export const REVIEW_MIN_DAYS = 7;
/** Our own pause between asks (Shopify also enforces 60 days / max 3 per year). */
export const REVIEW_PAUSE_DAYS = 60;
/** Orders checked before we consider the app "in use". */
export const REVIEW_MIN_CHECKS = 10;
export const REVIEW_NEVER = Number.MAX_SAFE_INTEGER;

type ReviewShop = { id: string; domain: string; installedAt: Date | string; settings: { reviewAskedAt?: number | null } };

export async function shouldAskReview(shop: ReviewShop): Promise<boolean> {
  if (isOwnerShop(shop.domain)) return false; // the developer can't review his own app
  const now = Date.now();
  if (now - new Date(shop.installedAt).getTime() < REVIEW_MIN_DAYS * DAY) return false;
  const last = Number(shop.settings.reviewAskedAt || 0);
  if (last && now - last < REVIEW_PAUSE_DAYS * DAY) return false;
  // value shown: enough orders checked AND Semafor flagged at least one risky order
  const [checks, flagged] = await Promise.all([
    db.orderCheck.count({ where: { shopId: shop.id } }),
    db.orderCheck.count({ where: { shopId: shop.id, OR: [{ level: { in: ["yellow", "red"] } }, { networkLevel: { in: ["yellow", "red"] } }] } }),
  ]);
  return checks >= REVIEW_MIN_CHECKS && flagged >= 1;
}

/** Shopify result codes after which we never ask this shop again. */
const FINAL = ["already-reviewed", "merchant-ineligible"];
/** Codes where the modal was not even attempted — don't start our 60-day pause. */
const RETRY = ["mobile-app", "already-open", "open-in-progress", "recently-installed"];

export async function markReviewAsked(shopId: string, code: string) {
  if (RETRY.includes(code)) return;
  await saveSettings(shopId, { reviewAskedAt: FINAL.includes(code) ? REVIEW_NEVER : Date.now() }, "semafor:system");
}
