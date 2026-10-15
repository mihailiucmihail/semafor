import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Card,
  Page,
  Text,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors, polarisTranslations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  // No manual shop-domain entry (App Store requirement 2.3.1): Shopify always opens the app with ?shop=…,
  // which login() turns into the OAuth redirect. Anyone landing here without it is told where to start.
  return (
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <Text variant="headingMd" as="h2">Semafor: COD Fraud &amp; Recovery</Text>
          <Text as="p">Open Semafor from your Shopify admin (Apps → Semafor), or install it from the Shopify App Store.</Text>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
