import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, Banner, ButtonGroup, Button, Tabs, Badge, Box } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { Fragment, useState } from "react";
import { authenticate } from "../shopify.server";
import { isOwnerShop } from "../semafor/plan.server";
import { reklama } from "../semafor/adorders.server";
import { memo } from "../semafor/memo.server";
import { CHANNEL_LABEL, PERIODS, PERIOD_LABEL, parsePeriod, type Channel, type PeriodKey } from "../../core/adattr";

// Owner-only page (Russian): which reel / ad brought which order, from Shopify's own visit data (UTM links).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  if (!isOwnerShop(session.shop)) throw new Response("Not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  const days = parsePeriod(sp.get("d"));
  const data = await memo(`reklama:${session.shop}:${days}`, 10 * 60_000, () => reklama(admin as any, days, session.shop), sp.get("fresh") === "1");
  return { ...data, store: session.shop.replace(".myshopify.com", "") };
};

const money = (m: Record<string, number>) => {
  const e = Object.entries(m).filter(([, v]) => v > 0);
  return e.length ? e.map(([c, v]) => `${v.toLocaleString("ro-RO", { maximumFractionDigits: 0 })} ${c === "RON" ? "lei" : c}`).join(" + ") : "—";
};
const lei = (n: number | null, cur: string | null) => (n == null ? "—" : `${n.toLocaleString("ro-RO", { maximumFractionDigits: n < 100 ? 2 : 0 })} ${!cur || cur === "RON" ? "lei" : cur}`);
const when = (s: string | null) => (s ? new Date(s).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }) : "—");
const TOUCH = { last: "последний клик", first: "первый визит" } as const;

export default function Reklama() {
  const d = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(Number(sp.get("t") ?? 0) || 0);
  const [open, setOpen] = useState<string | null>(null);
  const go = (days: PeriodKey) => { const p = new URLSearchParams(sp); p.set("d", String(days)); setSp(p); };
  const orderUrl = (id: string) => `https://admin.shopify.com/store/${d.store}/orders/${id.split("/").pop()}`;
  const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontWeight: 600, fontSize: 13, color: "#616161", whiteSpace: "nowrap", borderBottom: "1px solid #e3e3e3" };
  const td: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #f1f1f1", verticalAlign: "top" };
  const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const adOrders = d.orders.filter((o) => o.src.channel === "meta_ads");
  const tabs = [
    { id: "ads", content: `Рилсы / объявления (${d.rows.length})` },
    { id: "orders", content: `Заказы (${d.orders.length})` },
    { id: "channels", content: "Каналы" },
    { id: "carts", content: `Корзины (${d.carts.list.length})` },
  ];
  const STEP: Record<string, string> = { cart: "только корзина", started: "начал оформление", contact: "ввёл контакты", address: "ввёл адрес", shipping: "выбрал доставку", payment: "дошёл до оплаты", completed: "заказ" };
  const cartsByAd = (() => {
    const m = new Map<string, { campaign: string; ad: string; n: number; ordered: number }>();
    for (const c of d.carts.list) {
      const k = c.src?.channel === "meta_ads" ? `${c.src.campaign ?? ""}|${c.src.ad ?? ""}` : "—";
      const r = m.get(k) ?? { campaign: c.src?.channel === "meta_ads" ? c.src.campaign ?? "(без названия)" : "Не из рекламы / нет данных", ad: c.src?.channel === "meta_ads" ? c.src.ad ?? "—" : "", n: 0, ordered: 0 };
      r.n++; if (c.step === "completed") r.ordered++;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => (a.campaign.startsWith("Не из") ? 1 : 0) - (b.campaign.startsWith("Не из") ? 1 : 0) || b.n - a.n);
  })();

  return (
    <Page fullWidth>
      <TitleBar title="Реклама" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <Text as="p" tone="subdued">Какое объявление (рилс) привело какой заказ. Данные — визиты покупателя, которые видит Shopify, и метки в ссылках рекламы.</Text>
              <InlineStack gap="200">
                <ButtonGroup variant="segmented">
                  {PERIODS.map((n) => <Button key={n} pressed={d.days === n} onClick={() => go(n)}>{PERIOD_LABEL(n)}</Button>)}
                </ButtonGroup>
                <Button onClick={() => { const p = new URLSearchParams(sp); p.set("fresh", "1"); setSp(p); }}>Обновить</Button>
              </InlineStack>
            </InlineStack>

            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              <Card><BlockStack gap="100"><Text as="p" tone="subdued" variant="bodySm">Заказов за период</Text><Text as="p" variant="headingXl">{String(d.totals.orders)}</Text></BlockStack></Card>
              <Card><BlockStack gap="100"><Text as="p" tone="subdued" variant="bodySm">Из рекламы Meta</Text><Text as="p" variant="headingXl">{String(d.totals.ads)}</Text>
                <Text as="p" tone="subdued" variant="bodySm">{money(adOrders.filter((o) => !o.cancelled).reduce((m: Record<string, number>, o) => { m[o.currency] = (m[o.currency] ?? 0) + o.total; return m; }, {}))}</Text></BlockStack></Card>
              <Card><BlockStack gap="100"><Text as="p" tone="subdued" variant="bodySm">Потрачено на рекламу</Text><Text as="p" variant="headingXl">{d.meta.ok ? lei(d.rows.reduce((s, r) => s + (r.spend || 0), 0), d.meta.currency) : "—"}</Text>
                <Text as="p" tone="subdued" variant="bodySm">{d.meta.ok ? "по данным Meta" : "Meta не подключена"}</Text></BlockStack></Card>
              <Card><BlockStack gap="100"><Text as="p" tone="subdued" variant="bodySm">Без данных об источнике</Text><Text as="p" variant="headingXl">{String(d.totals.unknown)}</Text>
                <Text as="p" tone="subdued" variant="bodySm">покупатель отказался от cookies</Text></BlockStack></Card>
            </InlineGrid>

            {!d.meta.ok && (
              <Banner tone="info" title="Расход и названия из Meta не подгружены">
                <p>{d.meta.reason}. Заказы по объявлениям всё равно видны: их источник берётся из ссылки рекламы. Чтобы видеть ещё и потраченные деньги, нужен токен Meta с доступом к кабинету «Mihailiuc Group Ads».</p>
              </Banner>
            )}

            <Card padding="0">
              <Tabs tabs={tabs} selected={tab} onSelect={setTab} />
              <Box padding="0">
                {tab === 0 && (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead><tr>
                        <th style={th}>Кампания</th><th style={th}>Объявление (рилс)</th>
                        <th style={{ ...th, textAlign: "right" }}>Заказы</th><th style={{ ...th, textAlign: "right" }}>Выручка</th>
                        <th style={{ ...th, textAlign: "right" }}>Потрачено</th><th style={{ ...th, textAlign: "right" }}>Цена заказа</th>
                        <th style={{ ...th, textAlign: "right" }}>Просмотры страниц</th><th style={th}>Последний заказ</th>
                      </tr></thead>
                      <tbody>
                        {d.rows.length === 0 && <tr><td style={td} colSpan={8}><Text as="p" tone="subdued">За этот период нет заказов с меткой рекламы.</Text></td></tr>}
                        {d.rows.map((r) => {
                          const n = r.orders.filter((o) => !o.cancelled).length;
                          return (
                            <Fragment key={r.key}>
                              <tr style={{ cursor: r.orders.length ? "pointer" : "default", background: open === r.key ? "#f7f7f7" : undefined }} onClick={() => r.orders.length && setOpen(open === r.key ? null : r.key)}>
                                <td style={td}><Text as="span" fontWeight="semibold">{r.campaign}</Text>{r.adset && r.adset !== r.campaign && <div style={{ color: "#8a8a8a", fontSize: 12 }}>{r.adset}</div>}</td>
                                <td style={td}>{r.ad}</td>
                                <td style={num}>{n ? <Badge tone="success">{String(n)}</Badge> : "0"}</td>
                                <td style={num}>{money(r.revenue)}</td>
                                <td style={num}>{lei(r.spend, d.meta.currency)}</td>
                                <td style={num}>{r.spend != null && n ? lei(r.spend / n, d.meta.currency) : "—"}</td>
                                <td style={num}>{r.lpv == null ? "—" : r.lpv.toLocaleString("ro-RO")}</td>
                                <td style={td}>{when(r.lastAt)}{r.orders.length > 0 && <span style={{ color: "#8a8a8a" }}> {open === r.key ? "▲" : "▼"}</span>}</td>
                              </tr>
                              {open === r.key && (
                                <tr><td colSpan={8} style={{ ...td, background: "#fafafa" }}>
                                  <InlineStack gap="200" wrap>
                                    {r.orders.map((o) => (
                                      <a key={o.id} href={orderUrl(o.id)} target="_top" style={{ textDecoration: o.cancelled ? "line-through" : "none" }}>
                                        <Badge tone={o.cancelled ? undefined : "info"}>{`${o.name} · ${when(o.at)} · ${o.total} ${o.currency === "RON" ? "lei" : o.currency} · ${TOUCH[o.src.touch ?? "last"]}`}</Badge>
                                      </a>
                                    ))}
                                  </InlineStack>
                                </td></tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === 1 && (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead><tr>
                        <th style={th}>Заказ</th><th style={th}>Дата</th><th style={{ ...th, textAlign: "right" }}>Сумма</th>
                        <th style={th}>Источник</th><th style={th}>Кампания</th><th style={th}>Объявление (рилс)</th><th style={th}>Как узнали</th>
                      </tr></thead>
                      <tbody>
                        {d.orders.map((o) => (
                          <tr key={o.id} style={{ opacity: o.cancelled ? 0.5 : 1 }}>
                            <td style={td}><a href={orderUrl(o.id)} target="_top">{o.name}</a>{o.cancelled && " (отменён)"}</td>
                            <td style={td}>{when(o.at)}</td>
                            <td style={num}>{`${o.total} ${o.currency === "RON" ? "lei" : o.currency}`}</td>
                            <td style={td}>{o.src.channel === "meta_ads" ? <Badge tone="success">{CHANNEL_LABEL.meta_ads}</Badge> : CHANNEL_LABEL[o.src.channel as Channel]}</td>
                            <td style={td}>{o.src.campaign ?? "—"}</td>
                            <td style={td}>{o.src.ad ?? "—"}</td>
                            <td style={{ ...td, color: "#616161", fontSize: 13 }}>
                              {o.src.touch ? TOUCH[o.src.touch] : "—"}{o.src.also && o.src.also !== o.src.channel ? ` · ещё: ${CHANNEL_LABEL[o.src.also as Channel]}` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === 2 && (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead><tr><th style={th}>Канал</th><th style={{ ...th, textAlign: "right" }}>Заказы</th><th style={{ ...th, textAlign: "right" }}>Доля</th><th style={{ ...th, textAlign: "right" }}>Выручка</th></tr></thead>
                      <tbody>
                        {d.channels.map((c) => (
                          <tr key={c.channel}>
                            <td style={td}>{CHANNEL_LABEL[c.channel as Channel]}</td>
                            <td style={num}>{String(c.count)}</td>
                            <td style={num}>{d.totals.orders ? `${Math.round((c.count / d.totals.orders) * 100)}%` : "—"}</td>
                            <td style={num}>{money(c.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {tab === 3 && (
                  <BlockStack gap="0">
                    {!d.carts.tracking && (
                      <Box padding="400"><Banner tone="info" title="Метки рекламы для корзин ещё не приходили">
                        <p>Источник корзины записывается, когда человек приходит на сайт по ссылке рекламы и принимает cookies. Первые данные появятся после первых таких визитов.</p>
                      </Banner></Box>
                    )}
                    {cartsByAd.length > 0 && (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                          <thead><tr><th style={th}>Кампания</th><th style={th}>Объявление (рилс)</th><th style={{ ...th, textAlign: "right" }}>Корзин</th><th style={{ ...th, textAlign: "right" }}>Из них заказали</th></tr></thead>
                          <tbody>
                            {cartsByAd.map((r) => (
                              <tr key={r.campaign + r.ad}>
                                <td style={td}><Text as="span" fontWeight={r.campaign.startsWith("Не из") ? "regular" : "semibold"}>{r.campaign}</Text></td>
                                <td style={td}>{r.ad || "—"}</td>
                                <td style={num}>{String(r.n)}</td>
                                <td style={num}>{r.ordered ? <Badge tone="success">{String(r.ordered)}</Badge> : "0"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead><tr>
                          <th style={th}>Когда</th><th style={th}>Что в корзине</th><th style={{ ...th, textAlign: "right" }}>Сумма</th>
                          <th style={th}>Дошёл до</th><th style={th}>Откуда пришёл</th><th style={th}>Объявление (рилс)</th>
                        </tr></thead>
                        <tbody>
                          {d.carts.list.length === 0 && <tr><td style={td} colSpan={6}><Text as="p" tone="subdued">За этот период корзин нет.</Text></td></tr>}
                          {d.carts.list.map((c) => (
                            <tr key={c.deviceId}>
                              <td style={td}>{when(c.last)}{c.host && <div style={{ color: "#8a8a8a", fontSize: 12 }}>{c.host}</div>}</td>
                              <td style={td}>
                                <BlockStack gap="100">
                                  {c.items.map((it, k) => (
                                    <InlineStack key={k} gap="200" blockAlign="center" wrap={false}>
                                      {it.image && <img src={it.image} alt="" width={36} height={36} style={{ objectFit: "cover", borderRadius: 6 }} />}
                                      <span>{it.title}{it.variant ? ` — ${it.variant}` : ""}{it.qty > 1 ? ` × ${it.qty}` : ""}</span>
                                    </InlineStack>
                                  ))}
                                </BlockStack>
                              </td>
                              <td style={num}>{c.total != null ? `${c.total.toLocaleString("ro-RO", { maximumFractionDigits: 0 })} ${!c.currency || c.currency === "RON" ? "lei" : c.currency}` : "—"}</td>
                              <td style={td}>{c.step === "completed" ? (c.orderId ? <a href={orderUrl(c.orderId)} target="_top"><Badge tone="success">заказ</Badge></a> : <Badge tone="success">заказ</Badge>) : STEP[c.step] ?? c.step}</td>
                              <td style={td}>{c.src ? (c.src.channel === "meta_ads" ? <Badge tone="success">{CHANNEL_LABEL.meta_ads}</Badge> : CHANNEL_LABEL[c.src.channel as Channel]) : <span style={{ color: "#8a8a8a" }}>нет данных</span>}</td>
                              <td style={td}>{c.src?.channel === "meta_ads" ? <><div>{c.src.ad ?? "—"}</div><div style={{ color: "#8a8a8a", fontSize: 12 }}>{c.src.campaign}</div></> : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </BlockStack>
                )}
              </Box>
            </Card>

            <Text as="p" tone="subdued" variant="bodySm">
              Как считается: если покупатель хоть раз пришёл на сайт по ссылке рекламы (последний клик или первый визит), заказ засчитывается этому объявлению.
              Около трети покупателей не дают cookies — их заказы попадают в «Нет данных». Отменённые заказы показаны, но в выручку не входят.
              Обновлено: {when(d.at)}.
            </Text>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
