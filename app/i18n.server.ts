import db from "./db.server";
import { settingsOf, type ShopSettings } from "../core/settings";
import { isOwnerShop } from "./semafor/plan.server";
import { isLang, type Lang } from "./i18n";

type ShopLike = { id: string; domain: string; country?: string | null; settings: ShopSettings };
type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

/**
 * Admin UI language of a shop:
 *  1. settings.uiLang, when the merchant chose one in Settings;
 *  2. the Shopify admin locale (`locale` query param of the embedded app, or the last one seen) starting with "ro";
 *  3. the owner's own stores → Romanian;
 *  4. the shop's real country (from Shopify, cached in settings.shopCountry) = RO
 *     (Shop.country in the DB is always "RO" by default, so it can't be used for this);
 *  5. English.
 */
export function shopLang(shop: ShopLike, request?: Request): Lang {
  const s = shop.settings;
  if (isLang(s.uiLang)) return s.uiLang;
  const urlLocale = request ? new URL(request.url).searchParams.get("locale") : null;
  const locale = (urlLocale || s.adminLocale || "").toLowerCase();
  if (locale.startsWith("ro")) return "ro";
  if (isOwnerShop(shop.domain)) return "ro";
  if (String(s.shopCountry || "").toUpperCase() === "RO") return "ro";
  return "en";
}

/**
 * Called by the app layout loader: remembers the admin locale from the URL and, once, the shop's country,
 * so pages opened later (without `locale` in the URL) resolve to the same language. Mutates shop.settings.
 */
export async function rememberLangHints(admin: Admin, shop: ShopLike, request: Request) {
  const s = shop.settings;
  if (isLang(s.uiLang)) return;
  const patch: Partial<ShopSettings> = {};
  const loc = new URL(request.url).searchParams.get("locale");
  if (loc && loc !== s.adminLocale) patch.adminLocale = loc.slice(0, 20);
  if (!s.shopCountry) {
    try {
      const j: any = await (await admin.graphql(`#graphql
        query { shop { billingAddress { countryCodeV2 } } }`)).json();
      const c = j?.data?.shop?.billingAddress?.countryCodeV2;
      if (c) patch.shopCountry = String(c);
    } catch (e) {
      console.error("[semafor] shop country", e);
    }
  }
  if (!Object.keys(patch).length) return;
  try {
    const row = await db.shop.findUniqueOrThrow({ where: { id: shop.id } });
    await db.shop.update({ where: { id: shop.id }, data: { settings: { ...settingsOf(row.settings), ...patch } as any } });
    Object.assign(s, patch);
  } catch (e) {
    console.error("[semafor] rememberLangHints", e);
  }
}
