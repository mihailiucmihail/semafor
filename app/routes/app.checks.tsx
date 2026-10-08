import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { backfill } from "../semafor/backfill.server";
import { Page, Layout, Card, IndexTable, Badge, Text, EmptyState, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { Button, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const checks = await db.orderCheck.findMany({ where: { shopId: shop.id }, orderBy: { checkedAt: "desc" }, take: 200 });
  return { checks, storeHandle: session.shop.replace(".myshopify.com", "") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  try { return { ok: true as const, ...(await backfill(admin as any, shop, 50)) }; }
  catch (e: any) { return { ok: false as const, error: String(e?.message || e) }; }
};

const TONE = { green: "success", yellow: "warning", red: "critical" } as const;
const LABEL = { green: "Verde", yellow: "Galben", red: "Roșu" } as const;

export default function Checks() {
  const { checks, storeHandle } = useLoaderData<typeof loader>();
  const f = useFetcher<typeof action>();
  const d: any = f.data;
  return (
    <Page>
      <TitleBar title="Comenzi verificate" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="300">
          <Button loading={f.state !== "idle"} onClick={() => f.submit({}, { method: "post" })}>Verifică ultimele 50 de comenzi</Button>
          {d && d.ok && <Banner tone={d.red ? "critical" : d.yellow ? "warning" : "success"}>{`Verificate: ${d.checked} · roșu: ${d.red} · galben: ${d.yellow}${d.failed ? ` · erori: ${d.failed}` : ""}${d.noCustomerData ? ` · fără date client: ${d.noCustomerData}` : ""}`}</Banner>}
          {d && !d.ok && <Banner tone="critical">{d.error}</Banner>}
          <Card padding="0">
            {checks.length === 0 ? (
              <EmptyState heading="Nicio comandă verificată încă" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Fiecare comandă nouă este verificată automat. Rezultatele apar aici și în lista de comenzi (etichetă + semnal de risc).</p>
              </EmptyState>
            ) : (
              <IndexTable resourceName={{ singular: "comandă", plural: "comenzi" }} itemCount={checks.length} selectable={false}
                headings={[{ title: "Comandă" }, { title: "Semafor" }, { title: "Lista ta" }, { title: "Rețea" }, { title: "Potriviri" }, { title: "Acțiune" }, { title: "Când" }]}>
                {checks.map((c: any, i: number) => {
                  const own = c.level as keyof typeof TONE; const net = c.networkLevel as keyof typeof TONE;
                  const m = (c.matched as any[]) || [];
                  const oid = c.orderId.split("/").pop();
                  return (
                    <IndexTable.Row id={c.id} key={c.id} position={i}>
                      <IndexTable.Cell><a href={`https://admin.shopify.com/store/${storeHandle}/orders/${oid}`} target="_top" rel="noreferrer">{c.orderName || oid}</a></IndexTable.Cell>
                      <IndexTable.Cell>{(() => { const rk = { green: 0, yellow: 1, red: 2 } as const; const lv = rk[net] > rk[own] ? net : own; return <img src={`/light/${lv}?o=h`} alt={LABEL[lv]} height={26} style={{ display: "block" }} />; })()}</IndexTable.Cell>
                      <IndexTable.Cell><Badge tone={TONE[own]}>{`${LABEL[own]} · ${c.score}`}</Badge></IndexTable.Cell>
                      <IndexTable.Cell><Badge tone={TONE[net]}>{c.networkShops ? `${LABEL[net]} · ${c.networkShops} mag.` : "Verde"}</Badge></IndexTable.Cell>
                      <IndexTable.Cell>
                        <BlockStack gap="050">{m.length ? m.map((x, k) => <Text key={k} as="span" variant="bodySm">{x.kind === "device" || x.kind === "order" ? x.normalized : `${x.kind}: ${x.normalized} (${x.reason})`}</Text>) : <Text as="span" tone="subdued">—</Text>}</BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{c.actionTaken || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{new Date(c.checkedAt).toLocaleString("ro-RO")}</IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            )}
          </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
