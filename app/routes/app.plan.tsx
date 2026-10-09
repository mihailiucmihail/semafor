import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, Badge, Button, Banner, List, ProgressBar } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../semafor/shop.server";
import { refreshPlan, checksThisMonth, isOwnerShop } from "../semafor/plan.server";
import { FREE_MONTHLY_CHECKS, FEATURE_PLAN, type Feature, type Plan } from "../../core/plans";
import { useT, type TKey } from "../i18n";

/** Indicative prices shown in the app (texts in app/i18n.ts, plan.price.*); the real ones are set in the Partner Dashboard (managed pricing). */
const PLANS: Plan[] = ["free", "basic", "pro"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const plan = await refreshPlan(admin as any, shop);
  const used = await checksThisMonth(shop.id);
  const need = new URL(request.url).searchParams.get("need") as Feature | null;
  const store = session.shop.replace(/\.myshopify\.com$/, "");
  return {
    plan, used, owner: isOwnerShop(session.shop),
    need: need && need in FEATURE_PLAN ? { feature: need, plan: FEATURE_PLAN[need] } : null,
    pricingUrl: `https://admin.shopify.com/store/${store}/charges/${process.env.SHOPIFY_APP_HANDLE || (process.env.SHOPIFY_API_KEY === "a1d407ad72929fc485d5f9a4ef9a42b1" ? "semafor-app" : "semafor")}/pricing_plans`,
  };
};

export default function PlanPage() {
  const { plan, used, owner, need, pricingUrl } = useLoaderData<typeof loader>();
  const rank = { free: 0, basic: 1, pro: 2 } as const;
  const tr = useT();
  const planName = (p: Plan) => tr(`plan.name.${p}` as TKey);
  return (
    <Page title={tr("plan.title")}>
      <TitleBar title={tr("nav.plan")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {need && (
              <Banner tone="info" title={tr("plan.needBanner", { feature: tr(`plan.need.${need.feature}` as TKey), plan: need.plan === "pro" ? "Pro" : "Basic" })}>
                {tr("plan.needBody")}
              </Banner>
            )}
            {owner && <Banner tone="success">{tr("plan.owner")}</Banner>}
            {plan === "free" && (
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between"><Text as="h2" variant="headingSm">{tr("plan.usedHeading")}</Text><Text as="span">{Math.min(used, FREE_MONTHLY_CHECKS)} / {FREE_MONTHLY_CHECKS}</Text></InlineStack>
                  <ProgressBar progress={Math.min(100, (used / FREE_MONTHLY_CHECKS) * 100)} tone={used >= FREE_MONTHLY_CHECKS ? "critical" : "primary"} size="small" />
                  {used >= FREE_MONTHLY_CHECKS && <Text as="p" tone="critical">{tr("plan.limitReached")}</Text>}
                </BlockStack>
              </Card>
            )}
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {PLANS.map((id) => ({ id, name: planName(id), tagline: tr(`plan.tagline.${id}` as TKey), items: [1, 2, 3, 4].map((k) => tr(`plan.${id}.${k}` as TKey, { n: FREE_MONTHLY_CHECKS })) })).map((p) => (
                <Card key={p.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingLg">{p.name}</Text>
                      {plan === p.id && <Badge tone="success">{tr("plan.yourPlan")}</Badge>}
                    </InlineStack>
                    <Text as="p" tone="subdued">{p.tagline}</Text>
                    <Text as="p" variant="headingMd">{tr(`plan.price.${p.id}` as TKey)}</Text>
                    <List>{p.items.map((it) => <List.Item key={it}>{it}</List.Item>)}</List>
                    {!owner && plan !== p.id && (
                      <Button url={pricingUrl} target="_top" variant={rank[p.id] > rank[plan] ? "primary" : "secondary"}>
                        {rank[p.id] > rank[plan] ? tr("plan.upgrade", { name: p.name }) : tr("plan.switch", { name: p.name })}
                      </Button>
                    )}
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
            <Text as="p" variant="bodySm" tone="subdued">{tr("plan.billing")}</Text>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
