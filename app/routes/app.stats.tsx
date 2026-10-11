import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, IndexTable, Badge, Select, Banner, Box, Link, Avatar, Button } from "@shopify/polaris";
import { PersonIcon, ShieldNoneIcon, AlertTriangleIcon, ShieldPersonIcon, EmailIcon, PhoneIcon, OrderIcon } from "@shopify/polaris-icons";
import { Kpi, SignalStrip, SectionHead, IdLine } from "../components/semafor-ui";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireFeature } from "../semafor/plan.server";
import { enrichFromShopify } from "../semafor/recovery.server";
import { popupLeadMap } from "../semafor/popup.server";
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
  const f = new URL(request.url).searchParams.get("f") || "";
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
  // "cart" rows (before checkout) only matter for browsers whose e-mail is known from the pop-up
  const leads = await popupLeadMap(shop.id, [...devs.keys()]);
  const inCheckout = (d: Dev) => d.events.some((e) => e !== "cart");
  const all = [...devs.values()].filter((d) => inCheckout(d) || leads.has(d.id));
  const checkoutDevs = all.filter(inCheckout);
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
  const sends = (await db.emailSend.findMany({ where: { shopId: shop.id, status: "sent", kind: { not: "welcome" }, createdAt: { gt: new Date(+since - 7 * DAY) } }, select: { deviceId: true, email: true, kind: true, createdAt: true }, orderBy: { createdAt: "asc" } })) as any[];
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
    const lead = leads.get(d.id)?.email;
    for (const e of [...(d.emails as Set<string>), ...(lead ? [lead] : [])]) for (const x of byMail.get(e.toLowerCase()) ?? []) list.set(x.kind + +x.createdAt, x);
    const all = [...list.values()].sort((a, b) => +a.createdAt - +b.createdAt);
    if (!all.length) return null;
    const first = all[0].createdAt;
    const back = +(lastAt.get(d.id) ?? 0) > +first;
    const orderedAfter = d.completed && +(lastAt.get(d.id) ?? 0) > +first;
    return { count: all.length, kinds: all.map((x) => x.kind), last: all[all.length - 1].createdAt, back, orderedAfter };
  };
  const pick = f === "black" ? black : f === "slipped" ? slipped : f === "hopping" ? hopping : f === "ordered" ? all.filter((d) => d.completed) : all;
  const devices = [...pick].sort((a, b) => +b.last - +a.last).slice(0, 200).map((d) => ({
    id: d.id.slice(0, 6), dev: d.id, first: d.first, last: d.last, emails: [...d.emails], phones: [...d.phones], names: [...d.names], city: d.city,
    events: d.events, steps: d.steps, completed: d.completed, orderId: d.orderId ? d.orderId.split("/").pop() : null, orderName: d.orderId ? nameOf.get(d.orderId) ?? null : null,
    matched: d.matched, mail: mailInfo(d), popup: leads.get(d.id)?.email ?? null,
  }));
  const storeHandle = session.shop.replace(".myshopify.com", "");

  const firstAttempt = (await db.checkoutAttempt.findFirst({ where: { shopId: shop.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })) as any;
  return {
    days, f, since: firstAttempt?.createdAt ?? null,
    kpi: { attempts: attempts.filter((a) => a.event !== "cart").length, devices: checkoutDevs.length, completedDevices: checkoutDevs.filter((d) => d.completed).length, black: black.length, slipped: slipped.length, hopping: hopping.length },
    orders, suspicious, devices, storeHandle,
  };
};

const initials = (s: string) => (s.split(/[\s@.]+/).filter(Boolean).slice(0, s.includes("@") ? 1 : 2).map((w) => w[0]).join("") || "?").toUpperCase();

export default function Stats() {
  const { days, f, since, kpi, orders, suspicious, devices, storeHandle } = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const filterBy = (v: string) => { const n = new URLSearchParams(sp); if (!v || f === v) n.delete("f"); else n.set("f", v); setSp(n); setTimeout(() => document.getElementById("sf-attempts")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300); };
  const tr = useT();
  const lang = useLang();
  const loc = dateLocale(lang);
  const short = (d: string | Date) => new Date(d).toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Page fullWidth>
      <TitleBar title={tr("nav.stats")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <Text as="p" tone="subdued">{since ? tr("stats.trackingSince", { date: new Date(since).toLocaleString(loc) }) : tr("stats.noAttemptsYet")}</Text>
              <Box minWidth="200px">
                <Select label={tr("stats.period")} labelInline value={String(days)} onChange={(v) => { const n = new URLSearchParams(sp); n.set("d", v); setSp(n); }}
                  options={[{ label: tr("stats.today"), value: "1" }, { label: tr("stats.d7"), value: "7" }, { label: tr("stats.d30"), value: "30" }, { label: tr("stats.d90"), value: "90" }]} />
              </Box>
            </InlineStack>

            <BlockStack gap="300">
              <SectionHead title={tr("stats.checkout")} />
              <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="300">
                <Kpi icon={PersonIcon} label={tr("stats.kpiDevices")} value={kpi.devices} hint={tr("stats.kpiDevicesHint", { c: kpi.completedDevices, a: kpi.attempts })} onClick={() => filterBy("ordered")} active={f === "ordered"} />
                <Kpi icon={ShieldPersonIcon} label={tr("stats.kpiBlack")} value={kpi.black} tone={kpi.black ? "critical" : undefined} hint={tr("stats.kpiBlackHint")} onClick={() => filterBy("black")} active={f === "black"} />
                <Kpi icon={ShieldNoneIcon} label={tr("stats.kpiSlipped")} value={kpi.slipped} tone={kpi.slipped ? "critical" : "success"} hint={tr("stats.kpiSlippedHint")} onClick={() => filterBy("slipped")} active={f === "slipped"} />
                <Kpi icon={AlertTriangleIcon} label={tr("stats.kpiHopping")} value={kpi.hopping} tone={kpi.hopping ? "caution" : undefined} hint={tr("stats.kpiHoppingHint")} onClick={() => filterBy("hopping")} active={f === "hopping"} />
              </InlineGrid>
            </BlockStack>

            <Card>
              <BlockStack gap="300">
                <SectionHead title={tr("nav.checks")} description={tr("dash.checked", { n: orders.green + orders.yellow + orders.red })}>
                  <Button variant="plain" url="/app/checks" icon={OrderIcon}>{tr("dash.viewChecks")}</Button>
                </SectionHead>
                <SignalStrip green={orders.green} yellow={orders.yellow} red={orders.red}
                  labels={{ green: tr("level.green"), yellow: tr("level.yellow"), red: tr("level.red") }} emptyText={tr("stats.noChecks")} />
              </BlockStack>
            </Card>

            <Card padding="0">
              <Box padding="400"><SectionHead title={tr("stats.suspicious")} description={tr("stats.suspiciousHint")} /></Box>
              {suspicious.length === 0 ? (
                <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{tr("stats.noSuspicious")}</Text></Box>
              ) : (
                <div className="sf-table sf-md-hide-5">
                  <IndexTable resourceName={{ singular: tr("stats.resDevice"), plural: tr("stats.resDevices") }} itemCount={suspicious.length} selectable={false}
                    headings={[{ title: tr("stats.colDevice") }, { title: tr("stats.colTried") }, { title: tr("stats.colBlack") }, { title: tr("common.result") }, { title: tr("stats.colLast") }]}>
                    {suspicious.map((s: any, i: number) => (
                      <IndexTable.Row id={s.id + i} key={s.id + i} position={i}>
                        <IndexTable.Cell><Text as="span" variant="bodySm" tone="subdued">#{s.id}</Text></IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            {s.names.slice(0, 3).map((x: string, k: number) => <Text key={"n" + k} as="span" variant="bodySm" fontWeight="semibold"><span className="sf-break">{x}</span></Text>)}
                            {s.emails.slice(0, 3).map((x: string, k: number) => <IdLine key={"e" + k} icon={EmailIcon} label={tr("kind.email")}>{x}</IdLine>)}
                            {s.phones.slice(0, 3).map((x: string, k: number) => <IdLine key={"p" + k} icon={PhoneIcon} label={tr("kind.phone")}>{x}</IdLine>)}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {s.matched.length
                            ? <BlockStack gap="100" inlineAlign="start">{s.matched.slice(0, 4).map((m: string, k: number) => <Badge key={k} tone="critical">{m}</Badge>)}</BlockStack>
                            : s.hopping ? <Badge tone="warning">{tr("stats.hopping")}</Badge> : <Text as="span" tone="subdued">—</Text>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>{s.completed ? <Badge tone="critical">{tr("common.ordered")}</Badge> : <Badge>{tr("stats.notOrdered")}</Badge>}</IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodySm"><span className="sf-nowrap">{short(s.last)}</span></Text></IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </div>
              )}
            </Card>

            <div id="sf-attempts" />
            <Card padding="0">
              <Box padding="400">
                <SectionHead title={f ? tr(`stats.filter.${f}` as TKey) : tr("stats.allAttempts")} description={tr("stats.allAttemptsHint")}>
                  {f ? <Button variant="plain" onClick={() => filterBy("")}>{tr("stats.showAll")}</Button> : null}
                </SectionHead>
              </Box>
              {devices.length === 0 ? (
                <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{tr("stats.noAttempts")}</Text></Box>
              ) : (
                <div className="sf-table sf-lg-hide-4 sf-md-hide-2 sf-md-hide-6">
                  <IndexTable resourceName={{ singular: tr("index.resSingular"), plural: tr("index.resPlural") }} itemCount={devices.length} selectable={false}
                    headings={[{ title: tr("common.customer") }, { title: tr("stats.colContact") }, { title: tr("stats.colReached") }, { title: tr("stats.colEmails") }, { title: tr("common.result") }, { title: tr("common.when") }]}>
                    {devices.map((d: any, i: number) => {
                      const stepKey = d.completed ? "completed" : d.events.includes("payment") ? "payment" : d.events.includes("shipping") ? "shipping" : d.events.includes("address") ? "address" : d.events.includes("contact") ? "contact" : !d.events.includes("started") && d.events.includes("cart") ? "cart" : "started";
                      const step = tr(`stats.step.${stepKey}` as TKey);
                      const title = d.names[0] || d.emails[0] || d.popup || d.phones[0] || tr("common.customer");
                      return (
                        <IndexTable.Row id={d.id + i} key={d.id + i} position={i}>
                          <IndexTable.Cell>
                            <InlineStack gap="300" wrap={false} blockAlign="start">
                              <Avatar size="sm" initials={initials(title)} name={title} />
                              <BlockStack gap="050">
                                <Link url={`/app/client/${d.dev}`} removeUnderline><Text as="span" fontWeight="semibold"><span className="sf-break">{title}</span></Text></Link>
                                {d.city && <Text as="span" variant="bodySm" tone="subdued">{d.city}</Text>}
                                {d.names.length > 1 && <Text as="span" variant="bodySm" tone="caution"><span className="sf-break">{tr("stats.otherNames", { list: d.names.slice(1).join(", ") })}</span></Text>}
                              </BlockStack>
                            </InlineStack>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <BlockStack gap="050">
                              {d.emails.slice(0, 3).map((x: string, k: number) => <IdLine key={"e" + k} icon={EmailIcon} label={tr("kind.email")}>{x}</IdLine>)}
                              {d.phones.slice(0, 3).map((x: string, k: number) => <IdLine key={"p" + k} icon={PhoneIcon} label={tr("kind.phone")}>{x}</IdLine>)}
                              {d.popup && !d.emails.some((x: string) => x.toLowerCase() === d.popup) && <IdLine icon={EmailIcon} label={tr("kind.email")}>{d.popup}</IdLine>}
                              {d.popup && <span><Badge tone="magic">{tr("popup.badge")}</Badge></span>}
                              {!d.emails.length && !d.phones.length && !d.popup && <Text as="span" tone="subdued">—</Text>}
                            </BlockStack>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <BlockStack gap="050">
                              <Text as="span" variant="bodySm" tone={d.completed ? "success" : undefined}>{step}</Text>
                              <Link url={`/app/client/${d.dev}`}><Text as="span" variant="bodySm">{tr(d.steps === 1 ? "stats.stepsOne" : "stats.stepsMany", { n: d.steps })}</Text></Link>
                            </BlockStack>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {d.mail ? (
                              <BlockStack gap="100" inlineAlign="start">
                                <Badge tone="info">{tr(d.mail.count === 1 ? "stats.mailOne" : "stats.mailMany", { n: d.mail.count })}</Badge>
                                <Text as="span" variant="bodySm" tone="subdued">{d.mail.kinds.map((k: string) => (k === "auto1" ? "1" : k === "auto2" ? "2" : k === "auto3" ? "3" : tr("common.manual"))).join(", ")} · {tr("stats.mailLast", { date: new Date(d.mail.last).toLocaleString(loc, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</Text>
                                {d.mail.orderedAfter ? <Badge tone="success">{tr("stats.orderedAfter")}</Badge> : d.mail.back ? <Badge tone="attention">{tr("stats.cameBack")}</Badge> : null}
                              </BlockStack>
                            ) : <Text as="span" tone="subdued">—</Text>}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {d.orderId
                              ? <Button variant="plain" url={`https://admin.shopify.com/store/${storeHandle}/orders/${d.orderId}`} target="_top">{d.orderName || tr("stats.order")}</Button>
                              : d.matched.length ? <Badge tone="critical">{tr("stats.blackNoOrder")}</Badge> : <Badge>{tr("stats.abandoned")}</Badge>}
                          </IndexTable.Cell>
                          <IndexTable.Cell><Text as="span" variant="bodySm"><span className="sf-nowrap">{short(d.last)}</span></Text></IndexTable.Cell>
                        </IndexTable.Row>
                      );
                    })}
                  </IndexTable>
                </div>
              )}
            </Card>
            {kpi.attempts === 0 && <Banner tone="info">{tr("stats.appear")}</Banner>}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
