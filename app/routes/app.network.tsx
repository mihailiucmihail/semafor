// Network of stores: how reports from OTHER Semafor shops are read (yellow / red from N shops, which reasons count,
// optional payment hiding) and what the network found on this shop's orders.
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Select, Checkbox, ChoiceList, Button, Badge, Box, Banner } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { Dot, Lamp, SectionHead, type Level } from "../components/semafor-ui";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop, saveSettings, SECRET } from "../semafor/shop.server";
import { pushCheckoutMetafield } from "../semafor/entries.server";
import { planOf } from "../semafor/plan.server";
import { can } from "../../core/plans";
import { shopRef } from "../../core/hash";
import { networkOf, type NetworkSettings } from "../../core/settings";
import { useT, useLang, dateLocale, type TKey } from "../i18n";

const DAY = 86_400_000;
/** Reasons that can reach the network (return_no_reason / other stay in the shop's own list). */
const NET_REASONS = ["refuz_colet", "chargeback", "return_fraud", "abuse"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const own = shopRef(SECRET, shop.domain);
  const since = new Date(Date.now() - 30 * DAY);
  const [shared, myReports, others, hits] = await Promise.all([
    db.blockEntry.count({ where: { shopId: shop.id, shared: true } }),
    db.networkReport.count({ where: { shopRef: own, expiresAt: { gt: new Date() } } }),
    (db.networkReport.groupBy as any)({ by: ["shopRef"], where: { shopRef: { not: own }, expiresAt: { gt: new Date() } }, _count: { _all: true } }) as Promise<any[]>,
    db.orderCheck.findMany({
      where: { shopId: shop.id, networkShops: { gt: 0 }, checkedAt: { gt: since } },
      orderBy: { checkedAt: "desc" }, take: 30,
      select: { id: true, orderId: true, orderName: true, networkShops: true, networkLevel: true, networkReasons: true, checkedAt: true },
    }),
  ]);
  const people = others.reduce((s, r) => s + r._count._all, 0);
  return {
    shareNetwork: !!shop.settings.shareNetwork,
    network: networkOf(shop.settings.network),
    basic: can(planOf(shop), "checkout_block"),
    stats: { shops: others.length, reports: people, shared, myReports, yellow: hits.filter((h) => h.networkLevel === "yellow").length, red: hits.filter((h) => h.networkLevel === "red").length },
    hits,
    storeHandle: session.shop.replace(".myshopify.com", ""),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const fd = await request.formData();
  const reasons = String(fd.get("reasons") || "").split(",").filter((r) => (NET_REASONS as readonly string[]).includes(r));
  const network: NetworkSettings = networkOf({
    yellow: Number(fd.get("yellow")), red: Number(fd.get("red")), reasons: reasons as any,
    block: can(planOf(shop), "checkout_block") ? (String(fd.get("block")) as any) : "off",
  });
  await saveSettings(shop.id, { shareNetwork: fd.get("shareNetwork") === "true", network }, (session as any).email || session.shop);
  await pushCheckoutMetafield(admin as any, shop.id);
  return { ok: true };
};

export default function Network() {
  const d = useLoaderData<typeof loader>();
  const tr = useT();
  const lang = useLang();
  const app = useAppBridge();
  const f = useFetcher<typeof action>();
  const [share, setShare] = useState(d.shareNetwork);
  const [yellow, setYellow] = useState(String(d.network.yellow));
  const [red, setRed] = useState(String(d.network.red));
  const [reasons, setReasons] = useState<string[]>(d.network.reasons.filter((r) => (NET_REASONS as readonly string[]).includes(r)));
  const [block, setBlock] = useState<string>(d.network.block);
  useEffect(() => { if (f.state === "idle" && f.data?.ok) app.toast.show(tr("common.settingsSaved")); }, [f.state, f.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const y = Number(yellow), r = Number(red);
  const save = () => f.submit({ shareNetwork: String(share), yellow, red, reasons: reasons.join(","), block }, { method: "post" });
  const shopsOpt = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => ({ label: tr("net.shopsN", { n }), value: String(n) }));
  const when = (x: string | Date) => new Date(x).toLocaleString(dateLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const reasonText = (m: Record<string, number> | null) =>
    m ? Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${tr(`reason.${k}` as TKey)} — ${tr("net.shopsN", { n })}`).join(" · ") : "";

  return (
    <Page fullWidth>
      <TitleBar title={tr("nav.network")} />
      <BlockStack gap="400">
        <div className="sf-bl-hero">
          <div className="sf-bl-hero-top">
            <div className="sf-bl-hero-title">
              <span className="sf-lamp-v sf-bl-lamp"><Lamp size="lg" level={share ? "green" : "yellow"} label={tr("nav.network")} /></span>
              <div>
                <p className="sf-bl-eyebrow">Semafor · {tr("nav.network")}</p>
                <h1 className="sf-bl-count">{tr("net.heroTitle", { n: d.stats.shops })}</h1>
                <p className="sf-bl-sub">{tr("net.heroText")}</p>
              </div>
            </div>
          </div>
        </div>

        {!share && <Banner tone="warning">{tr("net.offBanner")}</Banner>}

        <div className="sf-ov-kpis">
          <div className="sf-ov-card"><Text as="span" variant="bodySm" tone="subdued">{tr("net.kShops")}</Text><span className="sf-ov-num">{d.stats.shops}</span><Text as="span" variant="bodySm" tone="subdued">{tr("net.kReports", { n: d.stats.reports })}</Text></div>
          <div className="sf-ov-card"><Text as="span" variant="bodySm" tone="subdued">{tr("net.kMine")}</Text><span className="sf-ov-num">{d.stats.shared}</span><Text as="span" variant="bodySm" tone="subdued">{tr("net.kMineHint")}</Text></div>
          <div className="sf-ov-card"><Text as="span" variant="bodySm" tone="subdued"><Dot level="yellow" /> {tr("net.kYellow")}</Text><span className="sf-ov-num yellow">{d.stats.yellow}</span><Text as="span" variant="bodySm" tone="subdued">{tr("net.k30")}</Text></div>
          <div className="sf-ov-card"><Text as="span" variant="bodySm" tone="subdued"><Dot level="red" /> {tr("net.kRed")}</Text><span className="sf-ov-num red">{d.stats.red}</span><Text as="span" variant="bodySm" tone="subdued">{tr("net.k30")}</Text></div>
        </div>

        <Layout>
          <Layout.AnnotatedSection title={tr("net.rulesTitle")} description={tr("net.rulesDesc")}>
            <Card>
              <BlockStack gap="400">
                <Checkbox label={tr("settings.networkLabel")} checked={share} onChange={setShare} helpText={tr("settings.networkHelp")} />
                <InlineStack gap="400" wrap>
                  <div style={{ flex: "1 1 220px" }}>
                    <Select label={<InlineStack gap="150" blockAlign="center"><Dot level="yellow" /><span>{tr("net.yellowFrom")}</span></InlineStack> as any} disabled={!share}
                      value={yellow} onChange={(v) => { setYellow(v); if (Number(v) >= r) setRed(String(Number(v) + 1)); }} options={shopsOpt(1, 9)} />
                  </div>
                  <div style={{ flex: "1 1 220px" }}>
                    <Select label={<InlineStack gap="150" blockAlign="center"><Dot level="red" /><span>{tr("net.redFrom")}</span></InlineStack> as any} disabled={!share}
                      value={red} onChange={setRed} options={shopsOpt(y + 1, 10)} />
                  </div>
                </InlineStack>
                <ChoiceList allowMultiple title={tr("net.reasonsTitle")} disabled={!share} selected={reasons} onChange={setReasons}
                  choices={NET_REASONS.map((x) => ({ label: tr(`reason.${x}` as TKey), value: x }))} />
                <Text as="p" variant="bodySm" tone="subdued">{tr("net.reasonsNote")}</Text>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection title={tr("net.blockTitle")} description={tr("net.blockDesc")}>
            <Card>
              <BlockStack gap="300">
                {!d.basic && <Banner tone="info" action={{ content: tr("settings.seePlans"), url: "/app/plan" }}>{tr("ov.lockedBasic")}</Banner>}
                <ChoiceList title={tr("net.blockTitle")} titleHidden disabled={!share || !d.basic} selected={[d.basic ? block : "off"]} onChange={(v) => setBlock(v[0])}
                  choices={[
                    { label: tr("net.blockOff"), value: "off", helpText: tr("net.blockOffHelp") },
                    { label: tr("net.blockRed", { n: r }), value: "red", helpText: tr("net.blockRedHelp") },
                    { label: tr("net.blockYellow", { n: y }), value: "yellow", helpText: tr("net.blockYellowHelp") },
                  ]} />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>

        <InlineStack align="end"><Button variant="primary" loading={f.state !== "idle"} onClick={save}>{tr("common.save")}</Button></InlineStack>

        <Card padding="0">
          <Box padding="400"><SectionHead title={tr("net.hitsTitle")} description={tr("net.hitsHint")} /></Box>
          {d.hits.length === 0 ? (
            <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{tr("net.hitsEmpty")}</Text></Box>
          ) : (
            <ul className="sf-ov-attn">
              {(d.hits as any[]).map((h) => (
                <li key={h.id}>
                  <a href={`https://admin.shopify.com/store/${d.storeHandle}/orders/${String(h.orderId).split("/").pop()}`} target="_top">
                    <Dot level={h.networkLevel as Level} />
                    <span className="sf-ov-order">{h.orderName || "—"}</span>
                    <span className="sf-ov-why">{reasonText(h.networkReasons as any) || tr("net.reportedBy", { n: h.networkShops })}</span>
                    <span className="sf-ov-when">{when(h.checkedAt)}</span>
                    <Badge tone={h.networkLevel === "red" ? "critical" : "warning"}>{tr("net.shopsN", { n: h.networkShops })}</Badge>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
