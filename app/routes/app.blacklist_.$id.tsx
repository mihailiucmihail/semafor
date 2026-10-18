// One blacklisted customer: every e-mail / phone / name / address / device on the entry, why and when it was
// added, all their Shopify orders, Semafor's order checks, checkout attempts and what changed on the entry.
import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button, Box, Divider, Modal, IndexTable, Banner } from "@shopify/polaris";
import { EmailIcon, PhoneIcon, LocationIcon, MobileIcon, PersonIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { IdLine, Dot, SectionHead, worst, type Level } from "../components/semafor-ui";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";
import { planOf } from "../semafor/plan.server";
import { can } from "../../core/plans";
import { useT, useLang, dateLocale, type TKey } from "../i18n";

type ShopOrder = {
  id: string; name: string; createdAt: string; financial: string | null; fulfillment: string | null; cancelledAt: string | null;
  total: number; currency: string; gateways: string[]; city: string | null; address: string | null; customerId: string | null;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const entry = await db.blockEntry.findFirst({
    where: { id: String(params.id), shopId: shop.id },
    include: { identifiers: { select: { kind: true, raw: true, normalized: true } } },
  });
  if (!entry) throw new Response("Not found", { status: 404 });
  const of = (k: string) => [...new Set(entry.identifiers.filter((i) => i.kind === k).map((i) => i.raw))];
  const emails = of("email"), phones = of("phone"), names = of("name"), addresses = of("address");
  const devices = [...new Set(entry.identifiers.filter((i) => i.kind === "device").map((i) => i.normalized))];

  // every Shopify order placed with one of the customer's e-mails or phones
  let orders: ShopOrder[] = [];
  let ordersError: string | null = null;
  const terms = [...emails.map((e) => `email:"${e.replace(/"/g, "")}"`), ...phones.map((p) => `phone:"${p.replace(/"/g, "")}"`)].slice(0, 12);
  if (terms.length) {
    try {
      const r = await admin.graphql(`#graphql
        query($q: String!) { orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $q) { nodes {
          id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
          totalPriceSet { shopMoney { amount currencyCode } }
          shippingAddress { address1 address2 city }
          customer { id }
        } } }`, { variables: { q: terms.join(" OR ") } });
      const j: any = await r.json();
      orders = (j?.data?.orders?.nodes ?? []).map((o: any) => ({
        id: String(o.id).split("/").pop(), name: o.name, createdAt: o.createdAt, financial: o.displayFinancialStatus ?? null, fulfillment: o.displayFulfillmentStatus ?? null,
        cancelledAt: o.cancelledAt ?? null, total: Number(o.totalPriceSet?.shopMoney?.amount) || 0, currency: o.totalPriceSet?.shopMoney?.currencyCode || "",
        gateways: o.paymentGatewayNames ?? [], city: o.shippingAddress?.city ?? null,
        address: [o.shippingAddress?.address1, o.shippingAddress?.address2].filter(Boolean).join(", ") || null,
        customerId: o.customer?.id ? String(o.customer.id).split("/").pop() : null,
      }));
      if (j?.errors?.length) ordersError = String(j.errors[0]?.message || "");
    } catch (e: any) {
      ordersError = String(e?.message || e);
    }
  }

  // Semafor's verdicts on orders that matched this entry
  const checks = (await db.orderCheck.findMany({
    where: { shopId: shop.id, matched: { array_contains: [{ entryId: entry.id }] } },
    orderBy: { checkedAt: "desc" }, take: 50,
    select: { id: true, orderId: true, orderName: true, level: true, networkLevel: true, actionTaken: true, checkedAt: true },
  })) as any[];

  // checkout attempts from the customer's browsers or with their e-mails
  const attempts = (devices.length || emails.length) ? ((await db.checkoutAttempt.findMany({
    where: { shopId: shop.id, event: { not: "cart" }, OR: [...(devices.length ? [{ deviceId: { in: devices } }] : []), ...emails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } }))] },
    orderBy: { createdAt: "desc" }, take: 60,
    select: { deviceId: true, event: true, email: true, phone: true, firstName: true, lastName: true, city: true, total: true, currency: true, orderId: true, createdAt: true },
  })) as any[]) : [];

  const history = (await db.auditLog.findMany({ where: { shopId: shop.id, entryId: entry.id }, orderBy: { at: "desc" }, take: 30, select: { action: true, actor: true, at: true, payload: true } })) as any[];

  const live = orders.filter((o) => !o.cancelledAt);
  return {
    entry: { id: entry.id, reason: entry.reason, note: entry.note, source: entry.source, orderId: entry.orderId ? entry.orderId.split("/").pop() : null, orderName: entry.orderName, createdBy: entry.createdBy, shared: entry.shared, createdAt: entry.createdAt, expiresAt: entry.expiresAt },
    emails, phones, names, addresses, devices,
    orders, ordersError, checks, attempts, history,
    stats: {
      orders: orders.length,
      cancelled: orders.length - live.length,
      paid: live.filter((o) => o.financial === "PAID").reduce((s, o) => s + o.total, 0),
      currency: orders[0]?.currency || "",
      first: orders.length ? orders[orders.length - 1].createdAt : null,
      last: orders[0]?.createdAt ?? null,
    },
    customerId: orders.find((o) => o.customerId)?.customerId ?? null,
    clientPage: can(planOf(shop), "recovery"),
    storeHandle: session.shop.replace(".myshopify.com", ""),
  };
};

const REASON_TONE: Record<string, "critical" | "warning" | undefined> = { refuz_colet: "critical", chargeback: "critical", abuse: "critical", return_fraud: "warning" };
const FIN_TONE: Record<string, "success" | "attention" | "critical" | "info" | undefined> = { PAID: "success", PENDING: "attention", AUTHORIZED: "attention", REFUNDED: "critical", PARTIALLY_REFUNDED: "warning" as any, VOIDED: "critical" };
const STEPS = ["started", "contact", "address", "shipping", "payment", "completed"];

export default function Customer() {
  const d = useLoaderData<typeof loader>();
  const tr = useT();
  const lang = useLang();
  const app = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher<any>();
  const [confirm, setConfirm] = useState(false);
  const when = (x: string | Date, time = true) => new Date(x).toLocaleString(dateLocale(lang), time ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" });
  const money = (v: number, c: string) => { try { return new Intl.NumberFormat(dateLocale(lang), { style: "currency", currency: c || "RON", maximumFractionDigits: 0 }).format(v); } catch { return `${Math.round(v)} ${c}`; } };
  const admin = (path: string) => `https://admin.shopify.com/store/${d.storeHandle}/${path}`;
  const title = d.names[0] || d.emails[0] || d.phones[0] || tr("common.customer");
  const sourceLabel = (s: string) => (["manual", "order", "import", "courier"].includes(s) ? tr(`source.${s}` as TKey) : s);
  const stepLabel = (s: string) => (STEPS.includes(s) ? tr(`cust.step.${s}` as TKey) : s);
  const actionLabel = (a: string) => (["entry.create", "entry.delete", "entry.link_device"].includes(a) ? tr(`cust.audit.${a.replace("entry.", "")}` as TKey) : a);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) { app.toast.show(tr("common.saved")); navigate("/app/blacklist"); }
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page backAction={{ content: tr("nav.blacklist"), url: "/app/blacklist" }} title={title}
      titleMetadata={<Badge tone={REASON_TONE[d.entry.reason]}>{tr(`reason.${d.entry.reason}` as TKey)}</Badge>}
      secondaryActions={[
        ...(d.customerId ? [{ content: tr("cust.openShopify"), url: admin(`customers/${d.customerId}`), target: "_top" as const }] : []),
        { content: tr("cust.remove"), destructive: true, onAction: () => setConfirm(true) },
      ]}>
      <TitleBar title={title} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* numbers */}
            <Card>
              <div className="sf-ov-kpis">
                <div><Text as="p" variant="bodySm" tone="subdued">{tr("cust.kOrders")}</Text><span className="sf-ov-num">{d.stats.orders}</span></div>
                <div><Text as="p" variant="bodySm" tone="subdued">{tr("cust.kCancelled")}</Text><span className={`sf-ov-num${d.stats.cancelled ? " red" : ""}`}>{d.stats.cancelled}</span></div>
                <div><Text as="p" variant="bodySm" tone="subdued">{tr("cust.kPaid")}</Text><span className="sf-ov-num">{money(d.stats.paid, d.stats.currency)}</span></div>
                <div><Text as="p" variant="bodySm" tone="subdued">{tr("cust.kAttempts")}</Text><span className="sf-ov-num">{d.attempts.length}</span></div>
              </div>
            </Card>

            {/* Shopify orders */}
            <Card padding="0">
              <Box padding="400"><SectionHead title={tr("cust.ordersTitle")} description={tr("cust.ordersHint")} /></Box>
              {d.ordersError && <Box padding="400" paddingBlockStart="0"><Banner tone="warning">{d.ordersError}</Banner></Box>}
              {d.orders.length === 0 ? (
                <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{tr("cust.noOrders")}</Text></Box>
              ) : (
                <div className="sf-table">
                  <IndexTable selectable={false} itemCount={d.orders.length} resourceName={{ singular: tr("checks.resSingular"), plural: tr("checks.resPlural") }}
                    headings={[{ title: tr("checks.colOrder") }, { title: tr("common.when") }, { title: tr("cust.colPayment") }, { title: tr("cust.colStatus") }, { title: tr("cust.colTotal") }, { title: tr("kind.address") }]}>
                    {(d.orders as ShopOrder[]).map((o, i) => (
                      <IndexTable.Row id={o.id} key={o.id} position={i}>
                        <IndexTable.Cell><Button variant="plain" url={admin(`orders/${o.id}`)} target="_top">{o.name}</Button></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodySm"><span className="sf-nowrap">{when(o.createdAt)}</span></Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodySm">{o.gateways.join(", ") || "—"}</Text></IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="100">
                            {o.cancelledAt ? <Badge tone="critical">{tr("cust.cancelled")}</Badge> : null}
                            {o.financial && <Badge tone={FIN_TONE[o.financial]}>{o.financial.replace(/_/g, " ").toLowerCase()}</Badge>}
                            {o.fulfillment && <Badge>{o.fulfillment.replace(/_/g, " ").toLowerCase()}</Badge>}
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodySm" fontWeight="semibold"><span className="sf-nowrap">{money(o.total, o.currency)}</span></Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodySm"><span className="sf-break">{[o.address, o.city].filter(Boolean).join(", ") || "—"}</span></Text></IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </div>
              )}
            </Card>

            {/* checkout attempts */}
            <Card padding="0">
              <Box padding="400"><SectionHead title={tr("cust.attemptsTitle")} description={tr("cust.attemptsHint")} /></Box>
              {d.attempts.length === 0 ? (
                <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{tr("cust.noAttempts")}</Text></Box>
              ) : (
                <ul className="sf-ov-attn">
                  {(d.attempts as any[]).map((a, i) => (
                    <li key={i}>
                      <div className="sf-cust-row">
                        <span className="sf-ov-when">{when(a.createdAt)}</span>
                        <Badge tone={a.event === "completed" ? "critical" : undefined}>{stepLabel(a.event)}</Badge>
                        <span className="sf-ov-why">{[a.email, a.phone, [a.firstName, a.lastName].filter(Boolean).join(" "), a.city].filter(Boolean).join(" · ") || "—"}</span>
                        {a.total != null && <span className="sf-ov-when">{money(a.total, a.currency || d.stats.currency)}</span>}
                        {d.clientPage && <Link to={`/app/client/${a.deviceId}`}>{tr("cust.device")} {String(a.deviceId).slice(0, 6)}</Link>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Semafor checks */}
            <Card padding="0">
              <Box padding="400"><SectionHead title={tr("cust.checksTitle")} description={tr("cust.checksHint")} /></Box>
              {d.checks.length === 0 ? (
                <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{tr("cust.noChecks")}</Text></Box>
              ) : (
                <ul className="sf-ov-attn">
                  {(d.checks as any[]).map((c) => {
                    const lv: Level = worst(c.level, c.networkLevel);
                    const acts = String(c.actionTaken || "").split("+").filter(Boolean);
                    return (
                      <li key={c.id}>
                        <a href={admin(`orders/${String(c.orderId).split("/").pop()}`)} target="_top">
                          <Dot level={lv} />
                          <span className="sf-ov-order">{c.orderName || "—"}</span>
                          <span className="sf-ov-why">{tr(`level.${lv}` as TKey)}{acts.length ? ` · ${acts.map((a) => (["tag", "risk", "cancel", "prepaid", "none"].includes(a) ? tr(`action.${a}` as TKey) : a)).join(", ")}` : ""}</span>
                          <span className="sf-ov-when">{when(c.checkedAt)}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* everything known about the customer */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{tr("cust.dataTitle")}</Text>
                <Group label={tr("cust.names")} items={d.names} icon={PersonIcon} />
                <Group label={tr("cust.emails")} items={d.emails} icon={EmailIcon} />
                <Group label={tr("cust.phones")} items={d.phones} icon={PhoneIcon} />
                <Group label={tr("cust.addresses")} items={d.addresses} icon={LocationIcon} />
                {d.devices.length > 0 && (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">{tr("cust.devices")}</Text>
                    {d.devices.map((x) => d.clientPage
                      ? <Link key={x} to={`/app/client/${x}`}><IdLine icon={MobileIcon} label={tr("kind.device")}>{x.slice(0, 10)}…</IdLine></Link>
                      : <IdLine key={x} icon={MobileIcon} label={tr("kind.device")}>{x.slice(0, 10)}…</IdLine>)}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* why */}
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">{tr("cust.whyTitle")}</Text>
                <InlineStack gap="200"><Badge tone={REASON_TONE[d.entry.reason]}>{tr(`reason.${d.entry.reason}` as TKey)}</Badge>{d.entry.shared ? <Badge tone="info">{tr("cust.shared")}</Badge> : <Badge>{tr("cust.local")}</Badge>}</InlineStack>
                {d.entry.note && <Text as="p">{d.entry.note}</Text>}
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">{tr("cust.addedOn", { date: when(d.entry.createdAt), source: sourceLabel(d.entry.source) })}</Text>
                {d.entry.orderId && <Text as="p" variant="bodySm">{tr("cust.fromOrder")} <a href={admin(`orders/${d.entry.orderId}`)} target="_top">{d.entry.orderName || d.entry.orderId}</a></Text>}
                {d.entry.createdBy && <Text as="p" variant="bodySm" tone="subdued">{d.entry.createdBy}</Text>}
                {d.entry.expiresAt && <Text as="p" variant="bodySm" tone="subdued">{tr("cust.expires", { date: when(d.entry.expiresAt, false) })}</Text>}
              </BlockStack>
            </Card>

            {/* history of the entry */}
            {d.history.length > 0 && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">{tr("cust.historyTitle")}</Text>
                  {(d.history as any[]).map((h, i) => (
                    <BlockStack key={i} gap="050">
                      <Text as="p" variant="bodySm" fontWeight="semibold">{actionLabel(h.action)}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{when(h.at)}{h.payload?.added ? ` · ${(h.payload.added as any[]).map((x) => x.kind === "device" ? tr("kind.device").toLowerCase() : x.raw).join(", ")}` : ""}</Text>
                    </BlockStack>
                  ))}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal open={confirm} onClose={() => setConfirm(false)} title={tr("cust.removeTitle")}
        primaryAction={{ content: tr("cust.remove"), destructive: true, loading: fetcher.state !== "idle", onAction: () => fetcher.submit({ intent: "delete", id: d.entry.id }, { method: "post", action: "/app/blacklist" }) }}
        secondaryActions={[{ content: tr("common.cancel"), onAction: () => setConfirm(false) }]}>
        <Modal.Section><Text as="p">{tr("cust.removeText", { name: title })}</Text></Modal.Section>
      </Modal>
    </Page>
  );
}

function Group({ label, items, icon }: { label: string; items: string[]; icon: any }) {
  if (!items.length) return null;
  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
      {items.map((x) => <IdLine key={x} icon={icon} label={label}>{x}</IdLine>)}
    </BlockStack>
  );
}
