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

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const plan = await refreshPlan(admin as any, shop);
  await ensureWebhooks(admin as any, session.shop).catch((e) => console.error("[semafor] ensureWebhooks", e));
  await ensurePixel(admin as any, session.shop).catch((e) => console.error("[semafor] ensurePixel", e));
  return { apiKey: process.env.SHOPIFY_API_KEY || "", pro: can(plan, "recovery") };
};

export default function App() {
  const { apiKey, pro } = useLoaderData<typeof loader>();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Lista neagră</Link>
        <Link to="/app/stats">{pro ? "Statistici" : "Statistici · Pro"}</Link>
        <Link to="/app/emails">{pro ? "E-mailuri" : "E-mailuri · Pro"}</Link>
        <Link to="/app/checks">Comenzi verificate</Link>
        <Link to="/app/import">Import</Link>
        <Link to="/app/settings">Setări</Link>
        <Link to="/app/plan">Plan</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
