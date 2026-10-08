// Semafor plans. Prices and plan names live in the Partner Dashboard (Shopify managed pricing);
// the app only reads which plan is active and unlocks features.
//
//   free  (Gratuit) — manual blacklist + network, traffic light on up to FREE_MONTHLY_CHECKS orders / month
//   basic (Basic)   — unlimited orders, blocking in checkout (hide COD / block), auto-cancel red,
//                     yellow actions, identities linked by device
//   pro   (Pro)     — + checkout steps analytics, client page, recovery e-mails (manual + automatic)
import type { ShopSettings } from './settings';

export type Plan = 'free' | 'basic' | 'pro';
export const PLAN_RANK: Record<Plan, number> = { free: 0, basic: 1, pro: 2 };
export const FREE_MONTHLY_CHECKS = 50;

export type Feature =
  | 'unlimited_checks' | 'checkout_block' | 'auto_cancel' | 'yellow_actions' | 'device_links'
  | 'checkout_stats' | 'recovery';

export const FEATURE_PLAN: Record<Feature, Plan> = {
  unlimited_checks: 'basic',
  checkout_block: 'basic',
  auto_cancel: 'basic',
  yellow_actions: 'basic',
  device_links: 'basic',
  checkout_stats: 'pro',
  recovery: 'pro',
};

export function normPlan(p: string | null | undefined): Plan {
  return p === 'pro' || p === 'basic' ? p : 'free';
}

export function can(plan: string | null | undefined, f: Feature): boolean {
  return PLAN_RANK[normPlan(plan)] >= PLAN_RANK[FEATURE_PLAN[f]];
}

/** Plan from the name of the active Shopify subscription ("Pro", "Semafor Basic", …). */
export function planFromSubscriptionName(name: string | null | undefined): Plan {
  const n = String(name || '').toLowerCase();
  if (/\bpro\b|premium/.test(n)) return 'pro';
  if (/basic|standard|start/.test(n)) return 'basic';
  return 'free';
}

/** Settings as they act for this plan (locked options fall back to the safe default). */
export function effectiveSettings(s: ShopSettings, plan: string | null | undefined): ShopSettings {
  return {
    ...s,
    yellowAction: can(plan, 'yellow_actions') ? s.yellowAction : 'tag',
    cancelRed: can(plan, 'auto_cancel') ? s.cancelRed : false,
  };
}
