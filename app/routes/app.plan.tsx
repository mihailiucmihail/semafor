import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, Badge, Button, Banner, List, ProgressBar } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../semafor/shop.server";
import { refreshPlan, checksThisMonth, isOwnerShop } from "../semafor/plan.server";
import { FREE_MONTHLY_CHECKS, FEATURE_PLAN, type Feature, type Plan } from "../../core/plans";

/** Indicative prices shown in the app; the real ones are set in the Partner Dashboard (managed pricing). */
const PRICE: Record<Plan, string> = { free: "0 $", basic: "9,99 $ / lună", pro: "24,99 $ / lună" };

const NEED_LABEL: Record<Feature, string> = {
  unlimited_checks: "verificarea tuturor comenzilor",
  checkout_block: "blocarea în checkout",
  auto_cancel: "anularea automată",
  yellow_actions: "acțiunile pentru clienții galbeni",
  device_links: "legarea identităților după dispozitiv",
  checkout_stats: "statistica pașilor din checkout",
  recovery: "e-mailurile pentru coșurile abandonate",
};

const PLANS: Array<{ id: Plan; name: string; tagline: string; items: string[] }> = [
  {
    id: "free", name: "Gratuit", tagline: "Pentru început",
    items: [
      `Semafor pe primele ${FREE_MONTHLY_CHECKS} de comenzi pe lună`,
      "Lista neagră proprie + import CSV",
      "Rețeaua de magazine (vezi cine a refuzat colete în altă parte)",
      "Etichetă și semnal de risc pe comandă",
    ],
  },
  {
    id: "basic", name: "Basic", tagline: "Protecție completă la ramburs",
    items: [
      "Tot din Gratuit, fără limită de comenzi",
      "Blocare în checkout: ascunde plata ramburs sau oprește comanda",
      "Anulare automată a comenzilor roșii",
      "Leagă identitățile încercate de pe același telefon",
    ],
  },
  {
    id: "pro", name: "Pro", tagline: "Protecție + vânzări recuperate",
    items: [
      "Tot din Basic",
      "Fiecare pas din checkout: unde a renunțat clientul și ce avea în coș",
      "E-mail de reamintire dintr-un clic, cu reducere unică",
      "Reamintiri automate (1 și 2), cu statistica comenzilor recuperate",
    ],
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const plan = await refreshPlan(admin as any, shop);
  const used = await checksThisMonth(shop.id);
  const need = new URL(request.url).searchParams.get("need") as Feature | null;
  const store = session.shop.replace(/\.myshopify\.com$/, "");
  return {
    plan, used, owner: isOwnerShop(session.shop),
    need: need && need in FEATURE_PLAN ? { label: NEED_LABEL[need], plan: FEATURE_PLAN[need] } : null,
    pricingUrl: `https://admin.shopify.com/store/${store}/charges/${process.env.SHOPIFY_APP_HANDLE || "semafor"}/pricing_plans`,
  };
};

export default function PlanPage() {
  const { plan, used, owner, need, pricingUrl } = useLoaderData<typeof loader>();
  const rank = { free: 0, basic: 1, pro: 2 } as const;
  return (
    <Page title="Planul tău">
      <TitleBar title="Plan" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {need && (
              <Banner tone="info" title={`Pentru ${need.label} ai nevoie de planul ${need.plan === "pro" ? "Pro" : "Basic"}`}>
                Alege planul mai jos — se activează imediat, fără să reinstalezi aplicația.
              </Banner>
            )}
            {owner && <Banner tone="success">Magazinul tău: toate funcțiile Pro sunt incluse.</Banner>}
            {plan === "free" && (
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between"><Text as="h2" variant="headingSm">Comenzi verificate luna aceasta</Text><Text as="span">{Math.min(used, FREE_MONTHLY_CHECKS)} / {FREE_MONTHLY_CHECKS}</Text></InlineStack>
                  <ProgressBar progress={Math.min(100, (used / FREE_MONTHLY_CHECKS) * 100)} tone={used >= FREE_MONTHLY_CHECKS ? "critical" : "primary"} size="small" />
                  {used >= FREE_MONTHLY_CHECKS && <Text as="p" tone="critical">Limita lunară a fost atinsă — comenzile noi nu mai sunt verificate până luna viitoare.</Text>}
                </BlockStack>
              </Card>
            )}
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {PLANS.map((p) => (
                <Card key={p.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingLg">{p.name}</Text>
                      {plan === p.id && <Badge tone="success">planul tău</Badge>}
                    </InlineStack>
                    <Text as="p" tone="subdued">{p.tagline}</Text>
                    <Text as="p" variant="headingMd">{PRICE[p.id]}</Text>
                    <List>{p.items.map((it) => <List.Item key={it}>{it}</List.Item>)}</List>
                    {!owner && plan !== p.id && (
                      <Button url={pricingUrl} target="_top" variant={rank[p.id] > rank[plan] ? "primary" : "secondary"}>
                        {rank[p.id] > rank[plan] ? `Treci la ${p.name}` : `Schimbă la ${p.name}`}
                      </Button>
                    )}
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
            <Text as="p" variant="bodySm" tone="subdued">Plata se face prin factura Shopify. Poți schimba sau anula planul oricând.</Text>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
