import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../semafor/shop.server";
import { ensureWebhooks, ensurePixel } from "../semafor/webhooks.server";
import { refreshPlan } from "../semafor/plan.server";
import { can } from "../../core/plans";
import { LangProvider, t } from "../i18n";
import { shopLang, rememberLangHints } from "../i18n.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const plan = await refreshPlan(admin as any, shop);
  await ensureWebhooks(admin as any, session.shop).catch((e) => console.error("[semafor] ensureWebhooks", e));
  await ensurePixel(admin as any, session.shop).catch((e) => console.error("[semafor] ensurePixel", e));
  await rememberLangHints(admin as any, shop, request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "", pro: can(plan, "recovery"), lang: shopLang(shop, request) };
};

export default function App() {
  const { apiKey, pro, lang } = useLoaderData<typeof loader>();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <LangProvider lang={lang}>
        <NavMenu>
          <Link to="/app" rel="home">{t(lang, "nav.blacklist")}</Link>
          <Link to="/app/stats">{t(lang, pro ? "nav.stats" : "nav.statsPro")}</Link>
          <Link to="/app/emails">{t(lang, pro ? "nav.emails" : "nav.emailsPro")}</Link>
          <Link to="/app/checks">{t(lang, "nav.checks")}</Link>
          <Link to="/app/import">{t(lang, "nav.import")}</Link>
          <Link to="/app/settings">{t(lang, "nav.settings")}</Link>
          <Link to="/app/plan">{t(lang, "nav.plan")}</Link>
        </NavMenu>
        <Outlet />
      </LangProvider>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
