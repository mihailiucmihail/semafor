import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, IndexTable, Badge, Select, Banner, Box, Link } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireFeature } from "../semafor/plan.server";
import { enrichFromShopify } from "../semafor/recovery.server";
import db from "../db.server";
import { ensureShop, SECRET } from "../semafor/shop.server";
import { buildIdentifiers } from "../semafor/entries.server";
import { hmacId } from "../../core/hash";
import { normEmail, normPhone, normName } from "../../core/normalize";
import { useT, useLang, dateLocale, type TKey } from "../i18n";

const DAY = 86_400_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "checkout_stats", redirect);
  await enrichFromShopify(admin as any, shop.id, 14).catch(() => 0);
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("d")) || 30));
  const since = new Date(Date.now() - days * DAY);

  const attempts = (await db.checkoutAttempt.findMany({ where: { shopId: shop.id, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take: 20000 })) as any[];

  // blacklist lookup for every identity tried in checkout (one query)
  const perAttempt = attempts.map((a) => buildIdentifiers({ email: a.email ?? undefined, phone: a.phone ?? undefined, firstName: a.firstName ?? undefined, lastName: a.lastName ?? undefined, address1: a.address1 ?? undefined, city: a.city ?? undefined, reason: "other" }, shop.country)
    .filter((i) => ["email", "phone", "name_address", "address"].includes(i.kind))
    .map((i) => ({ ...i, hash: hmacId(SECRET, i.kind, i.normalized) })));
  const hashes = [...new Set(perAttempt.flat().map((i) => i.hash))];
  const hits = hashes.length ? ((await db.identifier.findMany({ where: { shopId: shop.id, hash: { in: hashes } }, select: { hash: true, entry: { select: { reason: true } } } })) as any[]) : [];
  const hitSet = new Map(hits.map((h) => [h.hash, h.entry.reason]));

  type Dev = { id: string; first: Date; last: Date; emails: Set<string>; phones: Set<string>; names: Set<string>; steps: number; completed: boolean; matched: string[]; events: string[]; orderId: string | null; city: string | null };
  const devs = new Map<string, Dev>();
  attempts.forEach((a, idx) => {
    const d: Dev = devs.get(a.deviceId) ?? { id: a.deviceId, first: a.createdAt, last: a.createdAt, emails: new Set<string>(), phones: new Set<string>(), names: new Set<string>(), steps: 0, completed: false, matched: [] as string[], events: [] as string[], orderId: null, city: null };
    d.last = a.createdAt; d.steps++;
    if (!d.events.includes(a.event)) d.events.push(a.event);
    if (a.orderId) d.orderId = a.orderId;
    if (a.city) d.city = a.city;
    if (a.event === "completed") d.completed = true;
    const e = a.email && normEmail(a.email); if (e) d.emails.add(a.email);
    const p = a.phone && normPhone(a.phone, shop.country); if (p) d.phones.add(a.phone);
    const n = normName(a.firstName, a.lastName); if (n) d.names.add([a.firstName, a.lastName].filter(Boolean).join(" "));
    for (const i of perAttempt[idx]) if (hitSet.has(i.hash) && !d.matched.includes(i.raw)) d.matched.push(i.raw);
    devs.set(a.deviceId, d);
  });
  const all = [...devs.values()];
  const black = all.filter((d) => d.matched.length);
  const hopping = all.filter((d) => d.emails.size >= 3 || d.phones.size >= 3 || d.names.size >= 3 || d.emails.size + d.phones.size + d.names.size >= 6);
  const slipped = black.filter((d) => d.completed);

  const checks = (await db.orderCheck.findMany({ where: { shopId: shop.id, checkedAt: { gt: since } }, select: { level: true, networkLevel: true } })) as any[];
  const rank = { green: 0, yellow: 1, red: 2 } as const;
  const lv = (c: any) => (rank[c.networkLevel as keyof typeof rank] > rank[c.level as keyof typeof rank] ? c.networkLevel : c.level);
  const orders = { green: checks.filter((c) => lv(c) === "green").length, yellow: checks.filter((c) => lv(c) === "yellow").length, red: checks.filter((c) => lv(c) === "red").length };

  const suspicious = [...new Set([...black, ...hopping])]
    .sort((a, b) => +b.last - +a.last).slice(0, 50)
    .map((d) => ({ id: d.id.slice(0, 6), last: d.last, emails: [...d.emails], phones: [...d.phones], names: [...d.names], matched: d.matched, completed: d.completed, hopping: hopping.includes(d) }));

  // every device, newest first, with the order it ended in (if any)
  const orderIds = all.map((d) => d.orderId).filter(Boolean) as string[];
  const names = orderIds.length ? ((await db.orderCheck.findMany({ where: { shopId: shop.id, orderId: { in: orderIds } }, select: { orderId: true, orderName: true } })) as any[]) : [];
  const nameOf = new Map(names.map((n) => [n.orderId, n.orderName]));
  // recovery e-mails per buyer: how many were sent and whether she came back / ordered after the first one
  const sends = (await db.emailSend.findMany({ where: { shopId: shop.id, status: "sent", createdAt: { gt: new Date(+since - 7 * DAY) } }, select: { deviceId: true, email: true, kind: true, createdAt: true }, orderBy: { createdAt: "asc" } })) as any[];
  const byDev = new Map<string, any[]>(), byMail = new Map<string, any[]>();
  for (const x of sends) {
    (byDev.get(x.deviceId) ?? byDev.set(x.deviceId, []).get(x.deviceId)!).push(x);
    const m = String(x.email).toLowerCase(); (byMail.get(m) ?? byMail.set(m, []).get(m)!).push(x);
  }
  const lastAt = new Map<string, Date>(); // last checkout activity per device
  for (const a of attempts) lastAt.set(a.deviceId, a.createdAt);
  const mailInfo = (d: any) => {
    const list = new Map<string, any>();
    for (const x of byDev.get(d.id) ?? []) list.set(x.kind + +x.createdAt, x);
    for (const e of d.emails as Set<string>) for (const x of byMail.get(e.toLowerCase()) ?? []) list.set(x.kind + +x.createdAt, x);
    const all = [...list.values()].sort((a, b) => +a.createdAt - +b.createdAt);
    if (!all.length) return null;
    const first = all[0].createdAt;
    const back = +(lastAt.get(d.id) ?? 0) > +first;
    const orderedAfter = d.completed && +(lastAt.get(d.id) ?? 0) > +first;
    return { count: all.length, kinds: all.map((x) => x.kind), last: all[all.length - 1].createdAt, back, orderedAfter };
  };
  const devices = [...all].sort((a, b) => +b.last - +a.last).slice(0, 200).map((d) => ({
    id: d.id.slice(0, 6), dev: d.id, first: d.first, last: d.last, emails: [...d.emails], phones: [...d.phones], names: [...d.names], city: d.city,
    events: d.events, steps: d.steps, completed: d.completed, orderId: d.orderId ? d.orderId.split("/").pop() : null, orderName: d.orderId ? nameOf.get(d.orderId) ?? null : null,
    matched: d.matched, mail: mailInfo(d),
  }));
  const storeHandle = session.shop.replace(".myshopify.com", "");

  const firstAttempt = (await db.checkoutAttempt.findFirst({ where: { shopId: shop.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })) as any;
  return {
    days, since: firstAttempt?.createdAt ?? null,
    kpi: { attempts: attempts.length, devices: all.length, completedDevices: all.filter((d) => d.completed).length, black: black.length, slipped: slipped.length, hopping: hopping.length },
    orders, suspicious, devices, storeHandle,
  };
};

function Kpi({ label, value, tone, hint }: { label: string; value: number | string; tone?: "critical" | "caution" | "success"; hint?: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued">{label}</Text>
        <Text as="p" variant="heading2xl" tone={tone}>{value}</Text>
        {hint && <Text as="p" variant="bodySm" tone="subdued">{hint}</Text>}
      </BlockStack>
    </Card>
  );
}

export default function Stats() {
  const { days, since, kpi, orders, suspicious, devices, storeHandle } = useLoaderData<typeof loader>();
  const [, setSp] = useSearchParams();
  const total = orders.green + orders.yellow + orders.red;
  const tr = useT();
  const lang = useLang();
  const loc = dateLocale(lang);
  return (
    <Page>
      <TitleBar title={tr("nav.stats")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" tone="subdued">{since ? tr("stats.trackingSince", { date: new Date(since).toLocaleString(loc) }) : tr("stats.noAttemptsYet")}</Text>
              <Box minWidth="180px">
                <Select label={tr("stats.period")} labelInline value={String(days)} onChange={(v) => setSp({ d: v })}
                  options={[{ label: tr("stats.today"), value: "1" }, { label: tr("stats.d7"), value: "7" }, { label: tr("stats.d30"), value: "30" }, { label: tr("stats.d90"), value: "90" }]} />
              </Box>
            </InlineStack>

            <Text as="h2" variant="headingMd">{tr("stats.checkout")}</Text>
            <InlineGrid columns={{ xs: 2, md: 3 }} gap="300">
              <Kpi label={tr("stats.kpiDevices")} value={kpi.devices} hint={tr("stats.kpiDevicesHint", { c: kpi.completedDevices, a: kpi.attempts })} />
              <Kpi label={tr("stats.kpiBlack")} value={kpi.black} tone={kpi.black ? "critical" : undefined} hint={tr("stats.kpiBlackHint")} />
              <Kpi label={tr("stats.kpiSlipped")} value={kpi.slipped} tone={kpi.slipped ? "critical" : "success"} hint={tr("stats.kpiSlippedHint")} />
              <Kpi label={tr("stats.kpiHopping")} value={kpi.hopping} tone={kpi.hopping ? "caution" : undefined} hint={tr("stats.kpiHoppingHint")} />
            </InlineGrid>

            <Text as="h2" variant="headingMd">{tr("nav.checks")}</Text>
            <InlineGrid columns={{ xs: 3 }} gap="300">
              <Kpi label={tr("level.green")} value={orders.green} tone="success" hint={total ? `${Math.round((orders.green / total) * 100)}%` : undefined} />
              <Kpi label={tr("level.yellow")} value={orders.yellow} tone={orders.yellow ? "caution" : undefined} />
              <Kpi label={tr("level.red")} value={orders.red} tone={orders.red ? "critical" : undefined} />
            </InlineGrid>

            <Text as="h2" variant="headingMd">{tr("stats.suspicious")}</Text>
            <Card padding="0">
              {suspicious.length === 0 ? (
                <Box padding="400"><Text as="p" tone="subdued">{tr("stats.noSuspicious")}</Text></Box>
              ) : (
                <IndexTable resourceName={{ singular: tr("stats.resDevice"), plural: tr("stats.resDevices") }} itemCount={suspicious.length} selectable={false}
                  headings={[{ title: tr("stats.colDevice") }, { title: tr("stats.colTried") }, { title: tr("stats.colBlack") }, { title: tr("common.result") }, { title: tr("stats.colLast") }]}>
                  {suspicious.map((s: any, i: number) => (
                    <IndexTable.Row id={s.id + i} key={s.id + i} position={i}>
                      <IndexTable.Cell><Text as="span" variant="bodySm">#{s.id}</Text></IndexTable.Cell>
                      <IndexTable.Cell>
                        <BlockStack gap="050">
                          {[...s.emails, ...s.phones, ...s.names].slice(0, 8).map((x: string, k: number) => <Text key={k} as="span" variant="bodySm">{x}</Text>)}
                        </BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{s.matched.length ? <Badge tone="critical">{s.matched.join(", ")}</Badge> : s.hopping ? <Badge tone="warning">{tr("stats.hopping")}</Badge> : "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{s.completed ? <Badge tone="critical">{tr("common.ordered")}</Badge> : <Badge>{tr("stats.notOrdered")}</Badge>}</IndexTable.Cell>
                      <IndexTable.Cell>{new Date(s.last).toLocaleString(loc)}</IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </Card>
            <Text as="h2" variant="headingMd">{tr("stats.allAttempts")}</Text>
            <Card padding="0">
              {devices.length === 0 ? (
                <Box padding="400"><Text as="p" tone="subdued">{tr("stats.noAttempts")}</Text></Box>
              ) : (
                <IndexTable resourceName={{ singular: tr("index.resSingular"), plural: tr("index.resPlural") }} itemCount={devices.length} selectable={false}
                  headings={[{ title: tr("common.customer") }, { title: tr("stats.colContact") }, { title: tr("stats.colReached") }, { title: tr("stats.colEmails") }, { title: tr("common.result") }, { title: tr("common.when") }]}>
                  {devices.map((d: any, i: number) => {
                    const step = tr(`stats.step.${d.completed ? "completed" : d.events.includes("payment") ? "payment" : d.events.includes("shipping") ? "shipping" : d.events.includes("address") ? "address" : d.events.includes("contact") ? "contact" : "started"}` as TKey);
                    return (
                      <IndexTable.Row id={d.id + i} key={d.id + i} position={i}>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Link url={`/app/client/${d.dev}`} removeUnderline><Text as="span" fontWeight="semibold">{d.names[0] || d.emails[0] || "—"}</Text></Link>
                            {d.city && <Text as="span" variant="bodySm" tone="subdued">{d.city}</Text>}
                            {d.names.length > 1 && <Text as="span" variant="bodySm" tone="caution">{tr("stats.otherNames", { list: d.names.slice(1).join(", ") })}</Text>}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            {[...d.emails, ...d.phones].slice(0, 6).map((x: string, k: number) => <Text key={k} as="span" variant="bodySm">{x}</Text>)}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell><BlockStack gap="050"><Text as="span">{step}</Text><Link url={`/app/client/${d.dev}`}>{tr(d.steps === 1 ? "stats.stepsOne" : "stats.stepsMany", { n: d.steps })}</Link></BlockStack></IndexTable.Cell>
                        <IndexTable.Cell>
                          {d.mail ? (
                            <BlockStack gap="050">
                              <InlineStack gap="100"><Badge tone="info">{tr(d.mail.count === 1 ? "stats.mailOne" : "stats.mailMany", { n: d.mail.count })}</Badge></InlineStack>
                              <Text as="span" variant="bodySm" tone="subdued">{d.mail.kinds.map((k: string) => (k === "auto1" ? "1" : k === "auto2" ? "2" : k === "auto3" ? "3" : tr("common.manual"))).join(" · ")} · {tr("stats.mailLast", { date: new Date(d.mail.last).toLocaleString(loc, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</Text>
                              {d.mail.orderedAfter ? <Badge tone="success">{tr("stats.orderedAfter")}</Badge> : d.mail.back ? <Badge tone="attention">{tr("stats.cameBack")}</Badge> : null}
                            </BlockStack>
                          ) : <Text as="span" tone="subdued">—</Text>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {d.orderId
                            ? <a href={`https://admin.shopify.com/store/${storeHandle}/orders/${d.orderId}`} target="_top" rel="noreferrer">{d.orderName || tr("stats.order")}</a>
                            : d.matched.length ? <Badge tone="critical">{tr("stats.blackNoOrder")}</Badge> : <Badge>{tr("stats.abandoned")}</Badge>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>{new Date(d.last).toLocaleString(loc)}</IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
            </Card>
            {kpi.attempts === 0 && <Banner tone="info">{tr("stats.appear")}</Banner>}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
