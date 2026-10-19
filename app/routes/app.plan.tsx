import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, Badge, Button, Banner, ProgressBar, ButtonGroup, Divider, Icon } from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { Lamp, type Level } from "../components/semafor-ui";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../semafor/shop.server";
import { refreshPlan, checksThisMonth, isOwnerShop, trialBanner } from "../semafor/plan.server";
import { TrialBanner } from "../components/trial-banner";
import { launchOfferState, requestLaunchOffer } from "../semafor/launch-offer.server";
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
  const trial = plan === "free" ? await trialBanner({ ...shop, plan }).catch(() => null) : null;
  const owner = isOwnerShop(session.shop);
  const launch = await launchOfferState(admin as any, session.shop, owner).catch(() => ({ show: false, requested: false }));
  return {
    plan, used, owner, trial, launch,
    need: need && need in FEATURE_PLAN ? { feature: need, plan: FEATURE_PLAN[need] } : null,
    pricingUrl: `https://admin.shopify.com/store/${store}/charges/${process.env.SHOPIFY_APP_HANDLE || (process.env.SHOPIFY_API_KEY === "a1d407ad72929fc485d5f9a4ef9a42b1" ? "semafor-app" : "semafor")}/pricing_plans`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "launch-offer" || isOwnerShop(session.shop)) return { ok: false };
  return requestLaunchOffer(admin as any, session.shop);
};

export default function PlanPage() {
  const { plan, used, owner, need, pricingUrl, trial, launch } = useLoaderData<typeof loader>();
  const offer = useFetcher<{ ok: boolean }>();
  const offerSent = launch.requested || offer.data?.ok === true;
  const rank = { free: 0, basic: 1, pro: 2 } as const;
  const tr = useT();
  const [yearly, setYearly] = useState(false);
  const planName = (p: Plan) => tr(`plan.name.${p}` as TKey);
  const featured: Plan = plan === "free" ? "basic" : plan;
  const lampsOf: Record<Plan, Level[]> = { free: ["green"], basic: ["green", "yellow"], pro: ["green", "yellow", "red"] };
  const usedPct = Math.min(100, (used / FREE_MONTHLY_CHECKS) * 100);
  return (
    <Page fullWidth>
      <TitleBar title={tr("nav.plan")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {need && (
              <Banner tone="info" title={tr("plan.needBanner", { feature: tr(`plan.need.${need.feature}` as TKey), plan: need.plan === "pro" ? "Pro" : "Basic" })}>
                {tr("plan.needBody")}
              </Banner>
            )}
            {owner && <Banner tone="success">{tr("plan.owner")}</Banner>}
            <TrialBanner trial={trial as any} />
            {launch.show && (
              <Banner tone="success" title={tr("plan.launch.title")}>
                <BlockStack gap="300">
                  <Text as="p">{offerSent ? tr("plan.launch.thanks") : tr("plan.launch.body")}</Text>
                  {!offerSent && (
                    <InlineStack>
                      <Button variant="primary" loading={offer.state !== "idle"} onClick={() => offer.submit({ intent: "launch-offer" }, { method: "post" })}>{tr("plan.launch.cta")}</Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </Banner>
            )}

            <InlineStack align="space-between" blockAlign="end" gap="400">
              <BlockStack gap="100">
                <Text as="h1" variant="headingXl">{tr("plan.heading")}</Text>
                <Text as="p" tone="subdued">{tr("plan.subheading")}</Text>
              </BlockStack>
              <ButtonGroup variant="segmented">
                <Button pressed={!yearly} onClick={() => setYearly(false)}>{tr("plan.monthly")}</Button>
                <Button pressed={yearly} onClick={() => setYearly(true)}>{tr("plan.yearly")}</Button>
              </ButtonGroup>
            </InlineStack>

            {plan === "free" && !trial?.active && (
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingSm">{tr("plan.usedHeading")}</Text>
                    <Text as="span" fontWeight="semibold"><span className="sf-num">{Math.min(used, FREE_MONTHLY_CHECKS)} / {FREE_MONTHLY_CHECKS}</span></Text>
                  </InlineStack>
                  <ProgressBar progress={usedPct} tone={used >= FREE_MONTHLY_CHECKS ? "critical" : "primary"} size="small" />
                  {used >= FREE_MONTHLY_CHECKS && <Text as="p" tone="critical">{tr("plan.limitReached")}</Text>}
                </BlockStack>
              </Card>
            )}

            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {PLANS.map((id) => {
                const items = (id === "free" ? [1, 2, 3, 4] : [1, 2, 3, 4, 5, 6]).map((k) => tr(`plan.${id}.${k}` as TKey, { n: FREE_MONTHLY_CHECKS }));
                const name = planName(id);
                const yr = yearly && id !== "free";
                return (
                  <div key={id} className={`sf-plan${featured === id ? " sf-plan--featured" : ""}`}>
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center" gap="200">
                          <InlineStack gap="200" blockAlign="center">
                            <Lamp lit={lampsOf[id]} />
                            <Text as="h2" variant="headingLg">{name}</Text>
                          </InlineStack>
                          {trial?.active && id === "pro" ? <Badge tone="info">{tr("trial.badge", { n: trial.daysLeft })}</Badge> : plan === id && !trial?.active ? <Badge tone="success">{tr("plan.yourPlan")}</Badge> : id === "basic" && plan === "free" ? <Badge tone="info">{tr("plan.recommended")}</Badge> : null}
                        </InlineStack>
                        <Text as="p" tone="subdued">{tr(`plan.tagline.${id}` as TKey)}</Text>
                        <BlockStack gap="100">
                          <InlineStack gap="100" blockAlign="baseline">
                            <span className="sf-plan-price">{tr(`plan.amount${yr ? "Year" : ""}.${id}` as TKey)}</span>
                            {id !== "free" && <Text as="span" tone="subdued">{yr ? tr("plan.perYear") : tr("plan.perMonth")}</Text>}
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone={yr ? "success" : "subdued"}>
                            {id === "free" ? tr("plan.freeForever") : yr ? tr("plan.yearEquiv", { price: tr(`plan.amountYearMonth.${id}` as TKey) }) : tr("plan.yearlyHint")}
                          </Text>
                        </BlockStack>
                        {!owner && plan !== id ? (
                          <Button url={pricingUrl} target="_top" fullWidth variant={rank[id] > rank[plan] ? "primary" : "secondary"}>
                            {rank[id] > rank[plan] ? tr("plan.upgrade", { name }) : tr("plan.switch", { name })}
                          </Button>
                        ) : (
                          <Button fullWidth disabled>{plan === id ? (trial?.active ? tr("trial.afterTrial") : tr("plan.current")) : name}</Button>
                        )}
                        <Divider />
                        <ul className="sf-plan-items">
                          {items.map((it) => (
                            <li key={it}><Icon source={CheckIcon} /><span className="sf-plan-item">
                              <Text as="span" fontWeight="semibold">{it.split("|")[0]}</Text>
                              {it.includes("|") && <Text as="span" variant="bodySm" tone="subdued">{it.split("|").slice(1).join("|")}</Text>}
                            </span></li>
                          ))}
                        </ul>
                      </BlockStack>
                    </Card>
                  </div>
                );
              })}
            </InlineGrid>
            <Text as="p" variant="bodySm" tone="subdued" alignment="center">{tr("plan.billing")}</Text>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
