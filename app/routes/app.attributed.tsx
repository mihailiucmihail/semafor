import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { Page, Card, Text, Button, IndexTable, InlineStack, Box, BlockStack, InlineGrid } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireFeature } from "../semafor/plan.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";
import { attributionSummary, backfillAttribution } from "../semafor/attribution.server";
import { ATTR_SOURCES, type Attribution, type AttrSource } from "../../core/attribution";
import { AttrBadge, AttrKpi, type AttrSummaryData } from "../components/attribution";
import { useT, useLang, dateLocale, type TKey } from "../i18n";

const DAY = 86_400_000;

/** Orders brought by Semafor (last 30 days), optionally only one source (?src=popup_site|popup_cart|email|popup). */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "popup", redirect);
  await backfillAttribution(db, admin as any, shop);
  const src = new URL(request.url).searchParams.get("src") || "";
  const want: AttrSource[] = src === "popup" ? ["popup_site", "popup_cart"] : (ATTR_SOURCES as string[]).includes(src) ? [src as AttrSource] : ATTR_SOURCES;
  const rows = (await db.orderCheck.findMany({ where: { shopId: shop.id, checkedAt: { gt: new Date(Date.now() - 30 * DAY) } }, orderBy: { checkedAt: "desc" }, select: { orderId: true, orderName: true, attribution: true, total: true, currency: true, orderedAt: true, checkedAt: true } })) as any[];
  const orders = rows.filter((r) => (r.attribution as Attribution | null)?.primary && want.includes((r.attribution as Attribution).primary!)).slice(0, 300);
  const summary: AttrSummaryData = await attributionSummary(db, shop.id, 30, want);
  return { src, orders, summary, storeHandle: session.shop.replace(".myshopify.com", "") };
};

export default function Attributed() {
  const { src, orders, summary, storeHandle } = useLoaderData<typeof loader>();
  const tr = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [, setSp] = useSearchParams();
  const fmt = (d: any) => new Date(d).toLocaleString(dateLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const money = (v: number | null, c: string | null) => { if (v == null) return "—"; try { return new Intl.NumberFormat(dateLocale(lang), { style: "currency", currency: c || "EUR" }).format(v); } catch { return `${v} ${c || ""}`; } };
  const tabs = ["", "popup_site", "popup_cart", "email"];
  return (
    <Page fullWidth title={tr("nav.attributed")} backAction={{ content: tr("common.back"), onAction: () => (window.history.length > 1 ? navigate(-1) : navigate("/app/stats")) }}>
      <TitleBar title={tr("nav.attributed")} />
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="300"><AttrKpi s={summary} src={src} /></InlineGrid>
        <Text as="p" variant="bodySm" tone="subdued">{tr("attr.listHint")}</Text>
        <InlineStack gap="200">
          {tabs.map((k) => (
            <Button key={k || "all"} pressed={src === k} onClick={() => setSp(k ? { src: k } : {})}>{k ? tr(`attr.src.${k}` as TKey) : tr("attr.all")}</Button>
          ))}
        </InlineStack>
        <Card padding="0">
          {orders.length === 0 ? (
            <Box padding="400"><Text as="p" tone="subdued">{tr("attr.empty")}</Text></Box>
          ) : (
            <div className="sf-table sf-md-hide-4">
              <IndexTable selectable={false} itemCount={orders.length} resourceName={{ singular: tr("attr.colOrder"), plural: tr("nav.attributed") }}
                headings={[{ title: tr("attr.colOrder") }, { title: tr("attr.colSource") }, { title: tr("attr.colTotal") }, { title: tr("attr.colTouches") }, { title: tr("common.when") }]}>
                {orders.map((o: any, i: number) => {
                  const a = o.attribution as Attribution;
                  const oid = String(o.orderId).split("/").pop();
                  return (
                    <IndexTable.Row id={o.orderId} key={o.orderId} position={i}>
                      <IndexTable.Cell><Button variant="plain" url={`https://admin.shopify.com/store/${storeHandle}/orders/${oid}`} target="_top">{o.orderName || oid}</Button></IndexTable.Cell>
                      <IndexTable.Cell><AttrBadge a={a} /></IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" variant="bodySm" fontWeight="semibold"><span className="sf-nowrap sf-num">{money(o.total, o.currency)}</span></Text></IndexTable.Cell>
                      <IndexTable.Cell>
                        <BlockStack gap="050">{a.touches.map((t, k) => <Text key={k} as="span" variant="bodySm" tone="subdued">{tr(`attr.src.${t.source}` as TKey)} · {fmt(t.at)}</Text>)}</BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" variant="bodySm"><span className="sf-nowrap">{fmt(o.orderedAt || o.checkedAt)}</span></Text></IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            </div>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
