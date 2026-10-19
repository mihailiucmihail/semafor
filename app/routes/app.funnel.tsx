import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, Banner, ButtonGroup, Button, Box, Divider } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { isOwnerShop } from "../semafor/plan.server";
import { funnel, type FunnelRow } from "../semafor/funnel.server";
import { memo } from "../semafor/memo.server";

// Owner-only page (Russian, the owner's language): one place for the whole funnel, per reel.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isOwnerShop(session.shop)) throw new Response("Not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  const days = [1, 7, 14, 30].includes(Number(sp.get("d"))) ? Number(sp.get("d")) : 7;
  return memo(`funnel:${days}`, 5 * 60_000, () => funnel(days), sp.get("fresh") === "1");
};

const lei = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("ro-RO", { maximumFractionDigits: 2, minimumFractionDigits: n < 100 ? 2 : 0 })} lei`);
const num = (n: number | null) => (n == null ? "—" : n.toLocaleString("ro-RO"));
const per = (a: number | null, b: number | null) => (a == null || !b ? "—" : lei(a / b));
const pct = (a: number, b: number) => (!b ? "—" : `${Math.round((a / b) * 100)}%`);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
        <Text as="p" variant="headingXl">{value}</Text>
        {hint && <Text as="p" tone="subdued" variant="bodySm">{hint}</Text>}
      </BlockStack>
    </Card>
  );
}

export default function Funnel() {
  const d = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const t = d.totals;
  const go = (days: number) => { const p = new URLSearchParams(sp); p.set("d", String(days)); setSp(p); };
  const th: React.CSSProperties = { textAlign: "right", padding: "10px 12px", fontWeight: 600, fontSize: 13, color: "#616161", whiteSpace: "nowrap", borderBottom: "1px solid #e3e3e3" };
  const td: React.CSSProperties = { textAlign: "right", padding: "10px 12px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", borderBottom: "1px solid #f1f1f1" };
  const cols: [string, (r: FunnelRow) => string][] = [
    ["Потрачено", (r) => lei(r.spend)],
    ["Показы", (r) => num(r.impressions)],
    ["Клики по рекламе", (r) => num(r.linkClicks)],
    ["Загрузки сайта (Meta)", (r) => num(r.lpv)],
    ["Реальные посетители", (r) => num(r.visitors)],
    ["Клики «Установить»", (r) => num(r.installClicks)],
    ["% до клика", (r) => pct(r.installClicks, r.visitors)],
    ["Цена посетителя", (r) => per(r.spend, r.visitors)],
    ["Цена клика «Установить»", (r) => per(r.spend, r.installClicks)],
  ];
  return (
    <Page fullWidth>
      <TitleBar title="Воронка" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <BlockStack gap="100">
                <Text as="h1" variant="headingXl">Воронка: реклама → сайт → установка</Text>
                <Text as="p" tone="subdued">{d.sinceDay} — {d.untilDay} · обновлено {new Date(d.at).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })} (данные кэшируются на 5 минут)</Text>
              </BlockStack>
              <ButtonGroup variant="segmented">
                {[1, 7, 14, 30].map((n) => <Button key={n} pressed={d.days === n} onClick={() => go(n)}>{n === 1 ? "Сегодня" : `${n} дней`}</Button>)}
              </ButtonGroup>
            </InlineStack>

            {!d.meta.ok && (
              <Banner tone="warning" title="Данные Meta Ads не подключены">
                {d.meta.reason === "no_token"
                  ? "Затраты, показы и клики по рекламе появятся, когда в Railway будет добавлена переменная META_ADS_TOKEN (токен с правом ads_read). Остальные данные уже работают."
                  : `Meta ответила ошибкой: ${d.meta.reason}`}
              </Banner>
            )}

            <InlineGrid columns={{ xs: 2, md: 3, lg: 6 }} gap="300">
              <Kpi label="Потрачено на рекламу" value={d.meta.ok ? lei(t.spend) : "—"} />
              <Kpi label="Реальные посетители" value={num(t.visitors)} hint={`всего открытий: ${num(t.views)}`} />
              <Kpi label="Клики «Установить»" value={num(t.installClicks)} hint={`${pct(t.installClicks, t.visitors)} посетителей`} />
              <Kpi label="Установки" value={num(t.installs)} hint={`удалений: ${num(t.uninstalls)}`} />
              <Kpi label="Цена установки" value={d.meta.ok && t.installs ? lei(t.spend / t.installs) : "—"} />
              <Kpi label="Магазинов сейчас" value={num(t.activeNow)} hint={`платят: ${num(t.paying)}`} />
            </InlineGrid>

            <Card padding="0">
              <Box padding="400"><Text as="h2" variant="headingMd">По каждому рилсу и источнику</Text></Box>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead><tr><th style={{ ...th, textAlign: "left" }}>Источник</th>{cols.map(([h]) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.key}><td style={{ ...td, textAlign: "left", fontWeight: 500 }}>{r.label}</td>{cols.map(([h, f]) => <td key={h} style={td}>{f(r)}</td>)}</tr>
                    ))}
                    {!d.rows.length && <tr><td colSpan={cols.length + 1} style={{ ...td, textAlign: "center", color: "#616161" }}>Пока нет данных за этот период</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Как считается</Text>
                <Divider />
                <Text as="p" tone="subdued">«Реальные посетители» — люди, которые на сайте прокрутили страницу, нажали или коснулись экрана. Роботы, сканеры и автоматические браузеры не считаются. «Всего открытий» — все открытия страницы без роботов, включая тех, кто сразу ушёл.</Text>
                <Text as="p" tone="subdued">«Клики «Установить»» — переходы с сайта в Shopify App Store. Номер рилса передаётся дальше, в Shopify, Google Analytics и пиксель Meta.</Text>
                <Text as="p" tone="subdued">«Установки» — реальные магазины из нашей базы; твои магазины и тестовые не учитываются. Shopify не сообщает, с какого рилса пришёл магазин, поэтому установки показаны общим числом.</Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
