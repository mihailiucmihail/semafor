import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
import { useEffect } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, IndexTable, Badge, Select, Box, Link, Button, InlineGrid } from "@shopify/polaris";
import { EmailIcon, PhoneIcon, ShieldPersonIcon, ShieldNoneIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { Kpi, IdLine, SectionHead } from "../components/semafor-ui";
import { authenticate } from "../shopify.server";
import { requireFeature } from "../semafor/plan.server";
import { ensureShop, SECRET } from "../semafor/shop.server";
import { buildIdentifiers, nameOnlyEntries, nameOnlyHit } from "../semafor/entries.server";
import { hmacId } from "../../core/hash";
import db from "../db.server";
import { useT, useLang, dateLocale } from "../i18n";

const DAY = 86_400_000;

/**
 * "Blocked attempts": every checkout try by someone on the blacklist, newest first — who, what matched,
 * what was in the cart, how many tries, and whether she got through. Refreshes itself every 30 s.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "checkout_block", redirect);
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("d")) || 7));
  const since = new Date(Date.now() - days * DAY);

  const attempts = (await db.checkoutAttempt.findMany({
    where: { shopId: shop.id, createdAt: { gt: since }, event: { not: "cart" } },
    orderBy: { createdAt: "asc" }, take: 20000,
  })) as any[];

  const KINDS = ["email", "phone", "name_address", "address"];
  const per = attempts.map((a) => buildIdentifiers({ email: a.email ?? undefined, phone: a.phone ?? undefined, firstName: a.firstName ?? undefined, lastName: a.lastName ?? undefined, address1: a.address1 ?? undefined, city: a.city ?? undefined, reason: "other" }, shop.country)
    .filter((i) => KINDS.includes(i.kind)).map((i) => ({ ...i, hash: hmacId(SECRET, i.kind, i.normalized) })));
  const hashes = [...new Set(per.flat().map((i) => i.hash))];
  const hits = hashes.length ? ((await db.identifier.findMany({ where: { shopId: shop.id, hash: { in: hashes } }, select: { hash: true, entry: { select: { reason: true, createdAt: true } } } })) as any[]) : [];
  // a try only counts if the customer was ALREADY on the list at that moment (added later = not a blocked try)
  const hitMap = new Map<string, { reason: string; at: number }>();
  for (const h of hits) { const at = +new Date(h.entry.createdAt); const prev = hitMap.get(h.hash); if (!prev || at < prev.at) hitMap.set(h.hash, { reason: h.entry.reason, at }); }
  const nameOnly = await nameOnlyEntries(shop.id);

  type Row = { dev: string; first: Date; last: Date; names: Set<string>; emails: Set<string>; phones: Set<string>; city: string | null;
    matched: Map<string, string>; reasons: Set<string>; tries: number; total: number | null; currency: string | null; items: any[]; completed: boolean; orderId: string | null };
  const devs = new Map<string, Row>();
  attempts.forEach((a, k) => {
    const m = new Map<string, string>();
    const reasons = new Set<string>();
    for (const i of per[k]) { const h = hitMap.get(i.hash); if (h && h.at <= +a.createdAt) { m.set(i.raw, i.kind === "name_address" ? "name" : i.kind); reasons.add(h.reason); } }
    const nm = nameOnly.length ? nameOnlyHit(nameOnly, a.firstName, a.lastName, a.createdAt) : null;
    if (nm) m.set([a.firstName, a.lastName].filter(Boolean).join(" "), "name");
    const known = devs.get(a.deviceId);
    if (!m.size && !known) return;
    const r: Row = known ?? { dev: a.deviceId, first: a.createdAt, last: a.createdAt, names: new Set(), emails: new Set(), phones: new Set(), city: null, matched: new Map(), reasons: new Set(), tries: 0, total: null, currency: null, items: [], completed: false, orderId: null };
    r.last = a.createdAt; r.tries++;
    for (const [x, kind] of m) r.matched.set(x, kind);
    for (const x of reasons) r.reasons.add(x);
    const n = [a.firstName, a.lastName].filter(Boolean).join(" "); if (n) r.names.add(n);
    if (a.email) r.emails.add(a.email); if (a.phone) r.phones.add(a.phone); if (a.city) r.city = a.city;
    if (a.total != null) { r.total = Number(a.total); r.currency = a.currency; }
    if (Array.isArray(a.items) && a.items.length) r.items = a.items;
    if (a.event === "completed") r.completed = true;
    if (a.orderId) r.orderId = a.orderId;
    devs.set(a.deviceId, r);
  });

  const list = [...devs.values()].filter((r) => r.matched.size).sort((a, b) => +b.last - +a.last).slice(0, 300);
  const orderIds = list.map((r) => r.orderId).filter(Boolean) as string[];
  const names = orderIds.length ? ((await db.orderCheck.findMany({ where: { shopId: shop.id, orderId: { in: orderIds } }, select: { orderId: true, orderName: true } })) as any[]) : [];
  const nameOf = new Map(names.map((n) => [n.orderId, n.orderName]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return {
    days,
    storeHandle: session.shop.replace(".myshopify.com", ""),
    kpi: { people: list.length, today: list.filter((r) => +r.last >= +today).length, tries: list.reduce((s, r) => s + r.tries, 0), through: list.filter((r) => r.completed).length },
    rows: list.map((r) => ({
      dev: r.dev, first: r.first, last: r.last, names: [...r.names], emails: [...r.emails], phones: [...r.phones], city: r.city,
      matched: [...r.matched].map(([raw, kind]) => ({ raw, kind })), reasons: [...r.reasons], tries: r.tries,
      total: r.total, currency: r.currency, items: r.items.slice(0, 3).map((i: any) => ({ title: i?.title || "", variant: i?.variant || null, qty: i?.qty || 1, image: i?.image || null })),
      completed: r.completed, orderId: r.orderId ? r.orderId.split("/").pop() : null, orderName: r.orderId ? nameOf.get(r.orderId) ?? null : null,
    })),
    updatedAt: new Date().toISOString(),
  };
};

export default function Blocked() {
  const { days, rows, kpi, storeHandle, updatedAt } = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const rv = useRevalidator();
  const tr = useT();
  const loc = dateLocale(useLang());
  // live: refresh every 30 s while the page is open and visible
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible" && rv.state === "idle") rv.revalidate(); }, 30_000);
    return () => clearInterval(id);
  }, [rv]);
  const when = (d: string | Date) => new Date(d).toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const money = (v: number | null, c: string | null) => (v == null ? "—" : new Intl.NumberFormat(loc, { style: "currency", currency: c || "RON", maximumFractionDigits: 0 }).format(v));
  return (
    <Page fullWidth>
      <TitleBar title={tr("nav.blocked")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <Text as="p" tone="subdued">{tr("blocked.live", { time: new Date(updatedAt).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}</Text>
              <InlineStack gap="200" blockAlign="center">
                <Button onClick={() => rv.revalidate()} loading={rv.state !== "idle"}>{tr("blocked.refresh")}</Button>
                <Box minWidth="180px">
                  <Select label={tr("stats.period")} labelInline value={String(days)} onChange={(v) => { const n = new URLSearchParams(sp); n.set("d", v); setSp(n); }}
                    options={[{ label: tr("stats.today"), value: "1" }, { label: tr("stats.d7"), value: "7" }, { label: tr("stats.d30"), value: "30" }, { label: tr("stats.d90"), value: "90" }]} />
                </Box>
              </InlineStack>
            </InlineStack>

            <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="300">
              <Kpi icon={ShieldPersonIcon} label={tr("blocked.kpiPeople")} value={kpi.people} tone={kpi.people ? "critical" : undefined} hint={tr("blocked.kpiPeopleHint")} />
              <Kpi icon={ShieldPersonIcon} label={tr("blocked.kpiToday")} value={kpi.today} tone={kpi.today ? "critical" : undefined} hint={tr("blocked.kpiTodayHint")} />
              <Kpi label={tr("blocked.kpiTries")} value={kpi.tries} hint={tr("blocked.kpiTriesHint")} />
              <Kpi icon={ShieldNoneIcon} label={tr("blocked.kpiThrough")} value={kpi.through} tone={kpi.through ? "critical" : "success"} hint={tr("blocked.kpiThroughHint")} />
            </InlineGrid>

            <Card padding="0">
              <Box padding="400"><SectionHead title={tr("blocked.title")} description={tr("blocked.hint")} /></Box>
              {rows.length === 0 ? (
                <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{tr("blocked.none")}</Text></Box>
              ) : (
                <div className="sf-table sf-md-hide-3">
                  <IndexTable resourceName={{ singular: tr("blocked.resOne"), plural: tr("blocked.resMany") }} itemCount={rows.length} selectable={false}
                    headings={[{ title: tr("common.when") }, { title: tr("common.customer") }, { title: tr("blocked.colMatched") }, { title: tr("blocked.colCart") }, { title: tr("common.result") }]}>
                    {rows.map((r: any, i: number) => (
                      <IndexTable.Row id={r.dev + i} key={r.dev + i} position={i}>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" fontWeight="semibold"><span className="sf-nowrap">{when(r.last)}</span></Text>
                            <Text as="span" variant="bodySm" tone="subdued">{tr(r.tries === 1 ? "blocked.tryOne" : "blocked.tryMany", { n: r.tries })}</Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Link url={`/app/client/${r.dev}`} removeUnderline><Text as="span" fontWeight="semibold"><span className="sf-break">{r.names[0] || r.emails[0] || r.phones[0] || tr("common.customer")}</span></Text></Link>
                            {r.names.length > 1 && <Text as="span" variant="bodySm" tone="caution"><span className="sf-break">{tr("stats.otherNames", { list: r.names.slice(1).join(", ") })}</span></Text>}
                            {r.emails.slice(0, 3).map((x: string, k: number) => <IdLine key={"e" + k} icon={EmailIcon} label={tr("kind.email")}>{x}</IdLine>)}
                            {r.phones.slice(0, 2).map((x: string, k: number) => <IdLine key={"p" + k} icon={PhoneIcon} label={tr("kind.phone")}>{x}</IdLine>)}
                            {r.city && <Text as="span" variant="bodySm" tone="subdued">{r.city}</Text>}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100" inlineAlign="start">
                            {r.matched.slice(0, 4).map((m: any, k: number) => <Badge key={k} tone="critical">{`${tr(`kind.${m.kind}` as any)}: ${m.raw}`}</Badge>)}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span" fontWeight="semibold">{money(r.total, r.currency)}</Text>
                            {r.items.map((it: any, k: number) => <Text key={k} as="span" variant="bodySm" tone="subdued"><span className="sf-break">{it.qty > 1 ? `${it.qty}× ` : ""}{it.title}{it.variant ? ` · ${it.variant}` : ""}</span></Text>)}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {r.orderId
                            ? <BlockStack gap="100" inlineAlign="start"><Badge tone="critical">{tr("blocked.gotThrough")}</Badge><Button variant="plain" url={`https://admin.shopify.com/store/${storeHandle}/orders/${r.orderId}`} target="_top">{r.orderName || tr("stats.order")}</Button></BlockStack>
                            : r.completed ? <Badge tone="critical">{tr("blocked.gotThrough")}</Badge> : <Badge tone="success">{tr("blocked.stopped")}</Badge>}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </div>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
