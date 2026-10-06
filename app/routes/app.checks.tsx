import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, IndexTable, Badge, Text, EmptyState, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShop } from "../semafor/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getShop(session.shop);
  if (!shop) throw new Response("shop not found", { status: 404 });
  const checks = await db.orderCheck.findMany({ where: { shopId: shop.id }, orderBy: { checkedAt: "desc" }, take: 200 });
  return { checks, storeHandle: session.shop.replace(".myshopify.com", "") };
};

const TONE = { green: "success", yellow: "warning", red: "critical" } as const;
const LABEL = { green: "Verde", yellow: "Galben", red: "Roșu" } as const;

export default function Checks() {
  const { checks, storeHandle } = useLoaderData<typeof loader>();
  return (
    <Page>
      <TitleBar title="Comenzi verificate" />
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {checks.length === 0 ? (
              <EmptyState heading="Nicio comandă verificată încă" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Fiecare comandă nouă este verificată automat. Rezultatele apar aici și în lista de comenzi (etichetă + semnal de risc).</p>
              </EmptyState>
            ) : (
              <IndexTable resourceName={{ singular: "comandă", plural: "comenzi" }} itemCount={checks.length} selectable={false}
                headings={[{ title: "Comandă" }, { title: "Lista ta" }, { title: "Rețea" }, { title: "Potriviri" }, { title: "Acțiune" }, { title: "Când" }]}>
                {checks.map((c: any, i: number) => {
                  const own = c.level as keyof typeof TONE; const net = c.networkLevel as keyof typeof TONE;
                  const m = (c.matched as any[]) || [];
                  const oid = c.orderId.split("/").pop();
                  return (
                    <IndexTable.Row id={c.id} key={c.id} position={i}>
                      <IndexTable.Cell><a href={`https://admin.shopify.com/store/${storeHandle}/orders/${oid}`} target="_top" rel="noreferrer">{c.orderName || oid}</a></IndexTable.Cell>
                      <IndexTable.Cell><Badge tone={TONE[own]}>{`${LABEL[own]} · ${c.score}`}</Badge></IndexTable.Cell>
                      <IndexTable.Cell><Badge tone={TONE[net]}>{c.networkShops ? `${LABEL[net]} · ${c.networkShops} mag.` : "Verde"}</Badge></IndexTable.Cell>
                      <IndexTable.Cell>
                        <BlockStack gap="050">{m.length ? m.map((x, k) => <Text key={k} as="span" variant="bodySm">{x.kind}: {x.normalized} ({x.reason})</Text>) : <Text as="span" tone="subdued">—</Text>}</BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{c.actionTaken || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{new Date(c.checkedAt).toLocaleString("ro-RO")}</IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
