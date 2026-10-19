import db from "../db.server";
import { settingsOf, type ShopSettings } from "../../core/settings";
import { TRIAL_DAYS } from "../../core/plans";
import { notifyInstall } from "./install-notify.server";

export const SECRET = process.env.SEMAFOR_HASH_SECRET || "dev-secret-change-me";

/** Ensure a Shop row exists for this session's shop; returns it with parsed settings. */
export async function ensureShop(domain: string, accessToken: string) {
  // read first: the row only needs a write when the token changed or the shop came back after an uninstall
  let shop = await db.shop.findUnique({ where: { domain } });
  if (!shop) {
    shop = await db.shop.upsert({
      where: { domain },
      create: { domain, accessToken, country: "RO", trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) },
      update: { accessToken, uninstalledAt: null },
    });
    notifyInstall("install", domain, accessToken);
  } else if (shop.accessToken !== accessToken || shop.uninstalledAt) {
    const back = !!shop.uninstalledAt;
    shop = await db.shop.update({ where: { id: shop.id }, data: { accessToken, uninstalledAt: null } });
    if (back) notifyInstall("reinstall", domain, accessToken);
  }
  // stores installed shortly before the trial existed get the rest of their 14 days (once; a reinstall never renews it)
  if (!shop.trialEndsAt && shop.installedAt.getTime() > Date.now() - TRIAL_DAYS * 86_400_000) {
    shop = await db.shop.update({ where: { id: shop.id }, data: { trialEndsAt: new Date(shop.installedAt.getTime() + TRIAL_DAYS * 86_400_000) } });
  }
  return { ...shop, settings: settingsOf(shop.settings) as ShopSettings };
}

export async function getShop(domain: string) {
  const shop = await db.shop.findUnique({ where: { domain } });
  if (!shop) return null;
  return { ...shop, settings: settingsOf(shop.settings) as ShopSettings };
}

export async function saveSettings(shopId: string, patch: Partial<ShopSettings>, actor: string) {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const next = { ...settingsOf(shop.settings), ...patch };
  await db.shop.update({ where: { id: shopId }, data: { settings: next as any } });
  await db.auditLog.create({ data: { shopId, actor, action: "settings.update", payload: patch as any } });
  return next;
}
