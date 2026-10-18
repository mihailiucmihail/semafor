import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import semaforStyles from "../styles/semafor.css?url";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../semafor/shop.server";
import { ensureWebhooks, ensurePixel } from "../semafor/webhooks.server";
import { refreshPlan, isOwnerShop } from "../semafor/plan.server";
import { mailQuota } from "../semafor/quota.server";
import { ensurePopupConfig } from "../semafor/popup.server";
import { pushCheckoutMetafield } from "../semafor/entries.server";

/** Re-sync the checkout blocklist (metafields are wiped on uninstall) — at most every 10 minutes per shop. */
const blockSynced = new Map<string, number>();
import { Banner, Box, Text } from "@shopify/polaris";
import { can } from "../../core/plans";
import { LangProvider, t } from "../i18n";
import { shopLang, rememberLangHints } from "../i18n.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }, { rel: "stylesheet", href: semaforStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const plan = await refreshPlan(admin as any, shop);
  await ensureWebhooks(admin as any, session.shop).catch((e) => console.error("[semafor] ensureWebhooks", e));
  await ensurePixel(admin as any, session.shop).catch((e) => console.error("[semafor] ensurePixel", e));
  await rememberLangHints(admin as any, shop, request);
  // key includes the access token tail: a reinstall gets a new token → immediate re-sync (metafields were wiped)
  const installKey = (session.accessToken || "").slice(-8);
  const syncKey = shop.id + ":" + installKey;
  if (Date.now() - (blockSynced.get(syncKey) || 0) > 10 * 60_000) {
    blockSynced.set(syncKey, Date.now());
    pushCheckoutMetafield(admin as any, shop.id).catch((e) => console.error("[semafor] blocklist sync", e));
  }
  await ensurePopupConfig(admin as any, shop as any, installKey).catch((e) => console.error("[semafor] ensurePopupConfig", e));
  // Resend plan limits are global for all shops — only the app owner sees (and can act on) this warning
  const quota = isOwnerShop(session.shop) ? await mailQuota().catch(() => null) : null;
  return { apiKey: process.env.SHOPIFY_API_KEY || "", pro: can(plan, "recovery"), basic: can(plan, "popup"), lang: shopLang(shop, request), quota: quota && quota.level !== "ok" ? quota : null };
};

export default function App() {
  const { apiKey, pro, basic, lang, quota } = useLoaderData<typeof loader>();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <LangProvider lang={lang}>
        <NavMenu>
          <Link to="/app" rel="home">{t(lang, "nav.overview")}</Link>
          <Link to="/app/blacklist">{t(lang, "nav.blacklist")}</Link>
          <Link to="/app/checks">{t(lang, "nav.checks")}</Link>
          <Link to="/app/blocked">{t(lang, basic ? "nav.blocked" : "nav.blockedBasic")}</Link>
          <Link to="/app/stats">{t(lang, pro ? "nav.stats" : "nav.statsPro")}</Link>
          <Link to="/app/emails">{t(lang, pro ? "nav.emails" : "nav.emailsPro")}</Link>
          <Link to="/app/popup">{t(lang, basic ? "nav.popup" : "nav.popupBasic")}</Link>
          <Link to="/app/import">{t(lang, "nav.import")}</Link>
          <Link to="/app/settings">{t(lang, "nav.settings")}</Link>
          <Link to="/app/plan">{t(lang, "nav.plan")}</Link>
        </NavMenu>
        {quota && (
          <Box paddingBlockStart="400" paddingInline="400">
            <Banner tone={quota.level === "full" ? "critical" : "warning"} title={t(lang, quota.level === "full" ? "quota.fullTitle" : "quota.warnTitle")}
              action={{ content: t(lang, "quota.upgrade"), url: "https://resend.com/settings/billing", target: "_blank" }}>
              <Text as="p">{t(lang, "quota.body", { day: quota.day, dayLimit: quota.dayLimit || "∞", month: quota.month, monthLimit: quota.monthLimit || "∞" })}</Text>
            </Banner>
          </Box>
        )}
        <Outlet />
      </LangProvider>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
