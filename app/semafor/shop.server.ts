import db from "../db.server";
import { settingsOf, type ShopSettings } from "../../core/settings";

export const SECRET = process.env.SEMAFOR_HASH_SECRET || "dev-secret-change-me";

/** Ensure a Shop row exists for this session's shop; returns it with parsed settings. */
export async function ensureShop(domain: string, accessToken: string) {
  const shop = await db.shop.upsert({
    where: { domain },
    create: { domain, accessToken, country: "RO" },
    update: { accessToken, uninstalledAt: null },
  });
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
