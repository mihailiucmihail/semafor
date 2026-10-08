import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, IndexTable, Badge, Select, Banner, Box } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop, SECRET } from "../semafor/shop.server";
import { buildIdentifiers } from "../semafor/entries.server";
import { hmacId } from "../../core/hash";
import { normEmail, normPhone, normName } from "../../core/normalize";

const DAY = 86_400_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
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
  const devices = [...all].sort((a, b) => +b.last - +a.last).slice(0, 200).map((d) => ({
    id: d.id.slice(0, 6), first: d.first, last: d.last, emails: [...d.emails], phones: [...d.phones], names: [...d.names], city: d.city,
    events: d.events, steps: d.steps, completed: d.completed, orderId: d.orderId ? d.orderId.split("/").pop() : null, orderName: d.orderId ? nameOf.get(d.orderId) ?? null : null,
    matched: d.matched,
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
  return (
    <Page>
      <TitleBar title="Statistici" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" tone="subdued">{since ? `Urmărire la checkout activă din ${new Date(since).toLocaleString("ro-RO")}` : "Încă nu a fost înregistrată nicio încercare la checkout."}</Text>
              <Box minWidth="180px">
                <Select label="Perioada" labelInline value={String(days)} onChange={(v) => setSp({ d: v })}
                  options={[{ label: "Azi", value: "1" }, { label: "7 zile", value: "7" }, { label: "30 zile", value: "30" }, { label: "90 zile", value: "90" }]} />
              </Box>
            </InlineStack>

            <Text as="h2" variant="headingMd">Checkout</Text>
            <InlineGrid columns={{ xs: 2, md: 3 }} gap="300">
              <Kpi label="Clienți în checkout" value={kpi.devices} hint={`${kpi.completedDevices} au plasat comanda · ${kpi.attempts} pași în total`} />
              <Kpi label="Clienți din lista neagră care au încercat" value={kpi.black} tone={kpi.black ? "critical" : undefined} hint="dispozitive care au introdus un e-mail, telefon sau adresă din listă" />
              <Kpi label="…și au reușit totuși să comande" value={kpi.slipped} tone={kpi.slipped ? "critical" : "success"} hint="trecuți de blocare — verifică-i în Comenzi verificate" />
              <Kpi label="Schimbă datele" value={kpi.hopping} tone={kpi.hopping ? "caution" : undefined} hint="3+ e-mailuri, telefoane sau nume pe același dispozitiv" />
            </InlineGrid>

            <Text as="h2" variant="headingMd">Comenzi verificate</Text>
            <InlineGrid columns={{ xs: 3 }} gap="300">
              <Kpi label="Verde" value={orders.green} tone="success" hint={total ? `${Math.round((orders.green / total) * 100)}%` : undefined} />
              <Kpi label="Galben" value={orders.yellow} tone={orders.yellow ? "caution" : undefined} />
              <Kpi label="Roșu" value={orders.red} tone={orders.red ? "critical" : undefined} />
            </InlineGrid>

            <Text as="h2" variant="headingMd">Dispozitive suspecte</Text>
            <Card padding="0">
              {suspicious.length === 0 ? (
                <Box padding="400"><Text as="p" tone="subdued">Niciun dispozitiv suspect în această perioadă.</Text></Box>
              ) : (
                <IndexTable resourceName={{ singular: "dispozitiv", plural: "dispozitive" }} itemCount={suspicious.length} selectable={false}
                  headings={[{ title: "Dispozitiv" }, { title: "Ce a încercat" }, { title: "Din lista neagră" }, { title: "Rezultat" }, { title: "Ultima dată" }]}>
                  {suspicious.map((s: any, i: number) => (
                    <IndexTable.Row id={s.id + i} key={s.id + i} position={i}>
                      <IndexTable.Cell><Text as="span" variant="bodySm">#{s.id}</Text></IndexTable.Cell>
                      <IndexTable.Cell>
                        <BlockStack gap="050">
                          {[...s.emails, ...s.phones, ...s.names].slice(0, 8).map((x: string, k: number) => <Text key={k} as="span" variant="bodySm">{x}</Text>)}
                        </BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{s.matched.length ? <Badge tone="critical">{s.matched.join(", ")}</Badge> : s.hopping ? <Badge tone="warning">schimbă datele</Badge> : "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{s.completed ? <Badge tone="critical">a comandat</Badge> : <Badge>nu a comandat</Badge>}</IndexTable.Cell>
                      <IndexTable.Cell>{new Date(s.last).toLocaleString("ro-RO")}</IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </Card>
            <Text as="h2" variant="headingMd">Toate încercările de comandă</Text>
            <Card padding="0">
              {devices.length === 0 ? (
                <Box padding="400"><Text as="p" tone="subdued">Nicio încercare în această perioadă.</Text></Box>
              ) : (
                <IndexTable resourceName={{ singular: "client", plural: "clienți" }} itemCount={devices.length} selectable={false}
                  headings={[{ title: "Client" }, { title: "Contact" }, { title: "Până unde a ajuns" }, { title: "Rezultat" }, { title: "Când" }]}>
                  {devices.map((d: any, i: number) => {
                    const step = d.completed ? "a plătit / a plasat comanda" : d.events.includes("payment") ? "la plată" : d.events.includes("shipping") ? "a ales livrarea" : d.events.includes("address") ? "a completat adresa" : "a completat contactul";
                    return (
                      <IndexTable.Row id={d.id + i} key={d.id + i} position={i}>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span" fontWeight="semibold">{d.names[0] || "—"}</Text>
                            {d.city && <Text as="span" variant="bodySm" tone="subdued">{d.city}</Text>}
                            {d.names.length > 1 && <Text as="span" variant="bodySm" tone="caution">alte nume: {d.names.slice(1).join(", ")}</Text>}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            {[...d.emails, ...d.phones].slice(0, 6).map((x: string, k: number) => <Text key={k} as="span" variant="bodySm">{x}</Text>)}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell><BlockStack gap="050"><Text as="span">{step}</Text><Text as="span" variant="bodySm" tone="subdued">{d.steps} {d.steps === 1 ? "pas" : "pași"} în checkout</Text></BlockStack></IndexTable.Cell>
                        <IndexTable.Cell>
                          {d.orderId
                            ? <a href={`https://admin.shopify.com/store/${storeHandle}/orders/${d.orderId}`} target="_top" rel="noreferrer">{d.orderName || "Comanda"}</a>
                            : d.matched.length ? <Badge tone="critical">din lista neagră — fără comandă</Badge> : <Badge>a abandonat</Badge>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>{new Date(d.last).toLocaleString("ro-RO")}</IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
            </Card>
            {kpi.attempts === 0 && <Banner tone="info">Statisticile apar pe măsură ce clienții trec prin checkout.</Banner>}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
