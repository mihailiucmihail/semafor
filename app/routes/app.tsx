import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../semafor/shop.server";
import { ensureWebhooks, ensurePixel } from "../semafor/webhooks.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await ensureShop(session.shop, session.accessToken ?? "");
  await ensureWebhooks(admin as any, session.shop).catch((e) => console.error("[semafor] ensureWebhooks", e));
  await ensurePixel(admin as any, session.shop).catch((e) => console.error("[semafor] ensurePixel", e));
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Lista neagră</Link>
        <Link to="/app/stats">Statistici</Link>
        <Link to="/app/checks">Comenzi verificate</Link>
        <Link to="/app/import">Import</Link>
        <Link to="/app/settings">Setări</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
