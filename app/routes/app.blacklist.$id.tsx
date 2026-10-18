// One blacklisted customer: every e-mail / phone / name / address / device on the entry, why and when it was
// added, all their Shopify orders, Semafor's order checks, checkout attempts and what changed on the entry.
import { useEffect, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Layout, Card, BlockStack, InlineStack, Text, Badge, Button, Box, Divider, Modal, IndexTable, Banner, FormLayout, TextField } from "@shopify/polaris";
import { EmailIcon, PhoneIcon, LocationIcon, MobileIcon, PersonIcon, XSmallIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { IdLine, SectionHead, Lamp, worst, type Level } from "../components/semafor-ui";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";
import { addToEntry, pushCheckoutMetafield, isWeakAddress, unshareFromNetwork } from "../semafor/entries.server";
import { shopLang } from "../i18n.server";
import { planOf } from "../semafor/plan.server";
import { can } from "../../core/plans";
import { useT, useLang, dateLocale, t, trMsg, type TKey } from "../i18n";

type ShopOrder = {
  id: string; name: string; createdAt: string; financial: string | null; fulfillment: string | null; cancelledAt: string | null;
  total: number; currency: string; gateways: string[]; city: string | null; address: string | null; customerId: string | null;
  /** set when the order was found through the customer's browser, not their e-mail / phone: the name it was placed under */
  viaDevice?: string;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const entry = await db.blockEntry.findFirst({
    where: { id: String(params.id), shopId: shop.id },
    include: { identifiers: { select: { kind: true, raw: true, normalized: true } } },
  });
  if (!entry) throw new Response("Not found", { status: 404 });
  // Entries added from an order before addresses without a house number were kept: take the address from the order again
  if (entry.orderId && !entry.identifiers.some((i) => i.kind === "address")) {
    try {
      const r = await admin.graphql(`#graphql
        query($id: ID!) { order(id: $id) { shippingAddress { address1 address2 city } billingAddress { address1 address2 city } } }`, { variables: { id: entry.orderId } });
      const o: any = (await r.json())?.data?.order;
      const a = o?.shippingAddress || o?.billingAddress;
      if (a?.address1 && (await addToEntry(shop.id, entry.id, { address1: a.address1, address2: a.address2 || undefined, city: a.city || undefined }, shop.country, "semafor:repair"))) {
        const fresh = await db.identifier.findMany({ where: { entryId: entry.id }, select: { kind: true, raw: true, normalized: true } });
        entry.identifiers = fresh as any;
        await pushCheckoutMetafield(admin as any, shop.id).catch(() => {});
      }
    } catch (e) {
      console.error("[semafor] address repair", e);
    }
  }
  const of = (k: string) => [...new Set(entry.identifiers.filter((i) => i.kind === k).map((i) => i.raw))];
  const emails = of("email"), phones = of("phone"), names = of("name"), addresses = of("address");
  const weakAddresses = [...new Set(entry.identifiers.filter((i) => i.kind === "address" && isWeakAddress(i.normalized)).map((i) => i.raw))];
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

  // the customer's browsers: those on the entry + every browser that ever typed one of their e-mails / phones
  const seed = (emails.length || phones.length) ? ((await db.checkoutAttempt.findMany({
    where: { shopId: shop.id, OR: [...emails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })), ...(phones.length ? [{ phone: { in: phones } }] : [])] },
    select: { deviceId: true }, distinct: ["deviceId"], take: 50,
  })) as any[]).map((r) => r.deviceId) : [];
  const allDevices = [...new Set([...devices, ...seed])];

  // checkout attempts from those browsers or with the customer's e-mails
  const attempts = (allDevices.length || emails.length) ? ((await db.checkoutAttempt.findMany({
    where: { shopId: shop.id, event: { not: "cart" }, OR: [...(allDevices.length ? [{ deviceId: { in: allDevices } }] : []), ...emails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } }))] },
    orderBy: { createdAt: "desc" }, take: 100,
    select: { deviceId: true, event: true, email: true, phone: true, firstName: true, lastName: true, address1: true, city: true, total: true, currency: true, orderId: true, createdAt: true },
  })) as any[]) : [];

  // orders placed from the customer's browsers under OTHER names / e-mails (not found by e-mail / phone above)
  const known = new Set(orders.map((o) => o.id));
  const extraIds = [...new Set((attempts as any[]).map((a) => a.orderId).filter((x: string | null) => x && !known.has(String(x).split("/").pop()!)))].slice(0, 30) as string[];
  if (extraIds.length) {
    try {
      const r = await admin.graphql(`#graphql
        query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order {
          id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
          totalPriceSet { shopMoney { amount currencyCode } }
          shippingAddress { name address1 address2 city }
          customer { id }
        } } }`, { variables: { ids: extraIds } });
      const j: any = await r.json();
      for (const o of (j?.data?.nodes ?? []).filter(Boolean)) {
        if (!o.id) continue;
        orders.push({
          id: String(o.id).split("/").pop()!, name: o.name, createdAt: o.createdAt, financial: o.displayFinancialStatus ?? null, fulfillment: o.displayFulfillmentStatus ?? null,
          cancelledAt: o.cancelledAt ?? null, total: Number(o.totalPriceSet?.shopMoney?.amount) || 0, currency: o.totalPriceSet?.shopMoney?.currencyCode || "",
          gateways: o.paymentGatewayNames ?? [], city: o.shippingAddress?.city ?? null,
          address: [o.shippingAddress?.address1, o.shippingAddress?.address2].filter(Boolean).join(", ") || null,
          customerId: o.customer?.id ? String(o.customer.id).split("/").pop()! : null, viaDevice: o.shippingAddress?.name || "—",
        });
      }
      orders.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    } catch (e) {
      console.error("[semafor] device orders", e);
    }
  }

  // e-mails / phones / addresses typed from the same browsers that are NOT on the entry yet → one click to add them
  const lc = (x: string) => x.trim().toLowerCase();
  const digits = (x: string) => x.replace(/\D/g, "").slice(-9);
  const haveE = new Set(emails.map(lc)), haveP = new Set(phones.map(digits)), haveA = new Set(addresses.map(lc));
  const other = new Map<string, { kind: "email" | "phone" | "address"; value: string; city: string | null; last: Date; count: number }>();
  const note = (kind: "email" | "phone" | "address", value: string | null, city: string | null, at: Date) => {
    if (!value || !value.trim()) return;
    const known = kind === "email" ? haveE.has(lc(value)) : kind === "phone" ? haveP.has(digits(value)) : haveA.has(lc(value)) || haveA.has(lc([value, city].filter(Boolean).join(", ")));
    if (known) return;
    const k = kind + ":" + (kind === "phone" ? digits(value) : lc(value));
    const cur = other.get(k);
    if (cur) { cur.count++; if (+at > +cur.last) cur.last = at; } else other.set(k, { kind, value: value.trim(), city, last: at, count: 1 });
  };
  for (const a of attempts) { note("email", a.email, null, a.createdAt); note("phone", a.phone, null, a.createdAt); note("address", a.address1, a.city, a.createdAt); }
  const otherData = [...other.values()].sort((x, y) => +y.last - +x.last).slice(0, 20);

  const history = (await db.auditLog.findMany({ where: { shopId: shop.id, entryId: entry.id }, orderBy: { at: "desc" }, take: 30, select: { action: true, actor: true, at: true, payload: true } })) as any[];

  const live = orders.filter((o) => !o.cancelledAt);
  return {
    entry: { id: entry.id, reason: entry.reason, note: entry.note, source: entry.source, orderId: entry.orderId ? entry.orderId.split("/").pop() : null, orderName: entry.orderName, createdBy: entry.createdBy, shared: entry.shared, createdAt: entry.createdAt, expiresAt: entry.expiresAt },
    emails, phones, names, addresses, weakAddresses, devices,
    orders, ordersError, checks, attempts, history, otherData,
    stats: {
      orders: orders.length,
      viaDevice: orders.filter((o) => o.viaDevice).length,
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

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const entry = await db.blockEntry.findFirst({ where: { id: String(params.id), shopId: shop.id }, select: { id: true } });
  if (!entry) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const str = (k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() ? v.trim() : undefined; };
  const actor = (session as any).email || session.shop;
  if (fd.get("intent") === "remove") {
    const kind = String(fd.get("kind") || ""), value = String(fd.get("value") || "");
    const all = await db.identifier.findMany({ where: { entryId: entry.id }, select: { id: true, kind: true, raw: true, normalized: true, hash: true } });
    const gone = all.filter((i) => i.kind === kind && (i.raw === value || i.normalized === value));
    if (!gone.length) return { ok: true, removed: 0 };
    if (gone.length >= all.filter((i) => i.kind !== "name_address").length) {
      const lang = shopLang(shop, request);
      return { ok: false, error: t(lang, "cust.lastIdentifier") };
    }
    await db.identifier.deleteMany({ where: { id: { in: gone.map((i) => i.id) } } });
    // removed data leaves the network too (only this shop's reports)
    await unshareFromNetwork(shop.domain, gone.map((i) => i.hash)).catch(() => {});
    await db.auditLog.create({ data: { shopId: shop.id, actor, action: "entry.remove_data", entryId: entry.id, payload: { removed: gone.map((i) => ({ kind: i.kind, raw: i.raw })) } as any } });
    await pushCheckoutMetafield(admin as any, shop.id);
    return { ok: true, removed: gone.length };
  }
  try {
    let n = 0;
    if (fd.get("pick") === "all") {
      const list = JSON.parse(String(fd.get("all") || "[]")) as Array<{ kind: string; value: string; city?: string | null }>;
      for (const o of list.slice(0, 30)) {
        n += await addToEntry(shop.id, entry.id, o.kind === "email" ? { email: o.value } : o.kind === "phone" ? { phone: o.value } : { address1: o.value, city: o.city || undefined }, shop.country, actor);
      }
    } else {
      n = await addToEntry(shop.id, entry.id, {
        email: str("email"), phone: str("phone"), firstName: str("firstName"), lastName: str("lastName"), address1: str("address1"), city: str("city"),
      }, shop.country, actor);
    }
    if (n) await pushCheckoutMetafield(admin as any, shop.id);
    return { ok: true, added: n };
  } catch (e: any) {
    const lang = shopLang(shop, request);
    return { ok: false, error: e?.message ? trMsg(lang, e.message) : t(lang, "common.error") };
  }
};

const REASON_TONE: Record<string, "critical" | "warning" | undefined> = { return_no_reason: "warning", refuz_colet: "critical", chargeback: "critical", abuse: "critical", return_fraud: "warning" };
const FIN_TONE: Record<string, "success" | "attention" | "critical" | "info" | undefined> = { PAID: "success", PENDING: "attention", AUTHORIZED: "attention", REFUNDED: "critical", PARTIALLY_REFUNDED: "warning" as any, VOIDED: "critical" };
const REASON_HOT: Record<string, boolean> = { refuz_colet: true, chargeback: true, abuse: true };
const initialsOf = (t: string) => {
  const parts = t.replace(/[^\p{L}\p{N}\s@.]/gu, " ").split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 && !t.includes("@") ? parts[1][0] : "")).toUpperCase();
};
const STEPS = ["started", "contact", "address", "shipping", "payment", "completed"];

export default function Customer() {
  const d = useLoaderData<typeof loader>();
  const tr = useT();
  const lang = useLang();
  const app = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher<any>();
  const [confirm, setConfirm] = useState(false);
  const adder = useFetcher<any>();
  const remover = useFetcher<any>();
  const removing = remover.state !== "idle" ? String(remover.formData?.get("value") || "") : null;
  const rm = (kind: string) => ({
    removeLabel: tr("cust.removeData"), busy: removing,
    onRemove: (x: string) => remover.submit({ intent: "remove", kind, value: x }, { method: "post" }),
  });
  useEffect(() => {
    if (remover.state !== "idle" || !remover.data) return;
    if (remover.data.ok) app.toast.show(tr("cust.removedData"));
    else app.toast.show(remover.data.error || tr("common.error"), { isError: true });
  }, [remover.state, remover.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const EMPTY = { email: "", phone: "", firstName: "", lastName: "", address1: "", city: "" };
  const [form, setForm] = useState(EMPTY);
  const set = (k: keyof typeof EMPTY) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (adder.state !== "idle" || !adder.data) return;
    if (adder.data.ok) { app.toast.show(adder.data.added ? tr("cust.addedData", { n: adder.data.added }) : tr("cust.nothingNew")); setForm(EMPTY); }
    else app.toast.show(adder.data.error || tr("common.error"), { isError: true });
  }, [adder.state, adder.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const when = (x: string | Date, time = true) => new Date(x).toLocaleString(dateLocale(lang), time ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" });
  const money = (v: number, c: string) => { try { return new Intl.NumberFormat(dateLocale(lang), { style: "currency", currency: c || "RON", maximumFractionDigits: 0 }).format(v); } catch { return `${Math.round(v)} ${c}`; } };
  const admin = (path: string) => `https://admin.shopify.com/store/${d.storeHandle}/${path}`;
  const title = d.names[0] || d.emails[0] || d.phones[0] || tr("common.customer");
  const sourceLabel = (s: string) => (["manual", "order", "import", "courier"].includes(s) ? tr(`source.${s}` as TKey) : s);
  const stepLabel = (s: string) => (STEPS.includes(s) ? tr(`cust.step.${s}` as TKey) : s);
  const actionLabel = (a: string) => (["entry.create", "entry.delete", "entry.link_device", "entry.add_data", "entry.remove_data"].includes(a) ? tr(`cust.audit.${a.replace("entry.", "")}` as TKey) : a);

  type Ev = { at: string; tone: "red" | "yellow" | "green" | "gray"; title: string; text?: string; href?: string; device?: string };
  const timeline: Ev[] = [
    ...(d.orders as ShopOrder[]).map((o): Ev => ({
      at: o.createdAt, tone: o.cancelledAt ? "red" : o.financial === "PAID" ? "green" : "gray", href: admin(`orders/${o.id}`),
      title: `${tr("checks.colOrder")} ${o.name} · ${money(o.total, o.currency)}`,
      text: [o.viaDevice ? tr("cust.viaDevice", { name: o.viaDevice }) : null, o.cancelledAt ? tr("cust.cancelled") : null, o.financial?.replace(/_/g, " ").toLowerCase(), o.fulfillment?.replace(/_/g, " ").toLowerCase(), o.gateways.join(", ")].filter(Boolean).join(" · "),
    })),
    ...(d.checks as any[]).map((c): Ev => {
      const lv: Level = worst(c.level, c.networkLevel);
      return { at: c.checkedAt, tone: lv === "red" ? "red" : lv === "yellow" ? "yellow" : "green", href: admin(`orders/${String(c.orderId).split("/").pop()}`),
        title: `Semafor: ${tr(`level.${lv}` as TKey)} · ${c.orderName || ""}`,
        text: String(c.actionTaken || "").split("+").filter(Boolean).map((a: string) => (["tag", "risk", "cancel", "prepaid", "none"].includes(a) ? tr(`action.${a}` as TKey) : a)).join(", ") };
    }),
    ...(d.attempts as any[]).map((a): Ev => ({
      at: a.createdAt, tone: a.event === "completed" ? "red" : "gray", device: a.deviceId,
      title: stepLabel(a.event),
      text: [a.email, a.phone, [a.firstName, a.lastName].filter(Boolean).join(" "), a.city, a.total != null ? money(a.total, a.currency || d.stats.currency) : null].filter(Boolean).join(" · "),
    })),
    ...(d.history as any[]).map((h): Ev => ({
      at: h.at, tone: "gray", title: actionLabel(h.action),
      text: (h.payload?.added || h.payload?.removed) ? ((h.payload.added || h.payload.removed) as any[]).map((x) => (x.kind === "device" ? tr("kind.device").toLowerCase() : x.raw)).join(", ") : undefined,
    })),
  ].sort((x, y) => +new Date(y.at) - +new Date(x.at)).slice(0, 60);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) { app.toast.show(tr("common.saved")); navigate("/app/blacklist"); }
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sf-cu-page">
      <TitleBar title={title} />
      <div className="sf-cu-back"><Link to="/app/blacklist">← {tr("nav.blacklist")}</Link></div>
      {/* dossier header */}
      <div className="sf-cu-hero">
        <span className="sf-bl-ini sf-cu-ini" aria-hidden="true">{initialsOf(title)}</span>
        <div className="sf-cu-who">
          <div className="sf-cu-name-row">
            <h1 className="sf-cu-name">{title}</h1>
            <span className={`sf-cu-reason ${REASON_HOT[d.entry.reason] ? "hot" : ""}`}>{tr(`reason.${d.entry.reason}` as TKey)}</span>
          </div>
          <p className="sf-cu-sub">
            {tr("cust.addedOn", { date: when(d.entry.createdAt, false), source: sourceLabel(d.entry.source) })}
            {d.entry.orderName ? ` · ${d.entry.orderName}` : ""}
            {d.entry.shared ? ` · ${tr("cust.shared")}` : ""}
          </p>
        </div>
        <div className="sf-cu-risk">
          <span className="sf-bl-eyebrow">{tr("cust.risk")}</span>
          <span className="sf-bl-lamp"><Lamp level={REASON_HOT[d.entry.reason] ? "red" : "yellow"} label={tr("cust.risk")} /></span>
        </div>
        <div className="sf-bl-actions sf-cu-actions">
          {d.customerId && <a className="sf-bl-btn ghost" href={admin(`customers/${d.customerId}`)} target="_top">{tr("cust.openShopify")}</a>}
          <button type="button" className="sf-bl-btn ghost danger" onClick={() => setConfirm(true)}>{tr("cust.remove")}</button>
        </div>
      </div>
      <Box paddingBlockEnd="400" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* numbers */}
            <Card>
              <div className="sf-ov-kpis">
                <div><Text as="p" variant="bodySm" tone="subdued">{tr("cust.kOrders")}</Text><span className="sf-ov-num">{d.stats.orders}</span>{d.stats.viaDevice > 0 && <Text as="p" variant="bodySm" tone="caution">{tr("cust.kViaDevice", { n: d.stats.viaDevice })}</Text>}</div>
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
                            {o.viaDevice ? <Badge tone="attention">{tr("cust.viaDevice", { name: o.viaDevice })}</Badge> : null}
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

            {/* one timeline: orders, checkout attempts, Semafor checks and changes to the entry */}
            <Card>
              <BlockStack gap="400">
                <SectionHead title={tr("cust.historyTitle")} description={tr("cust.timelineHint")} />
                {timeline.length === 0 ? <Text as="p" tone="subdued">{tr("cust.noAttempts")}</Text> : (
                  <ol className="sf-cu-tl">
                    {timeline.map((ev, i) => (
                      <li key={i}>
                        <span className={`sf-cu-dot ${ev.tone}`} aria-hidden="true" />
                        <div>
                          <p className="sf-cu-when">{when(ev.at)}</p>
                          <p className="sf-cu-title">{ev.href ? <a href={ev.href} target="_top">{ev.title}</a> : ev.title}</p>
                          {ev.text && <p className="sf-cu-text">{ev.text}</p>}
                          {ev.device && d.clientPage && <Link to={`/app/client/${ev.device}`} className="sf-cu-text">{tr("cust.device")} {String(ev.device).slice(0, 6)} →</Link>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* everything known about the customer */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{tr("cust.dataTitle")}</Text>
                <Group label={tr("cust.names")} items={d.names} icon={PersonIcon} {...rm("name")} />
                <Group label={tr("cust.emails")} items={d.emails} icon={EmailIcon} {...rm("email")} />
                <Group label={tr("cust.phones")} items={d.phones} icon={PhoneIcon} {...rm("phone")} />
                <Group label={tr("cust.addresses")} items={d.addresses} icon={LocationIcon} {...rm("address")} />
                {d.weakAddresses.length > 0 && <Text as="p" variant="bodySm" tone="subdued">{tr("cust.weakAddr")}</Text>}
                <Group label={tr("cust.devices")} items={d.devices} icon={MobileIcon} {...rm("device")}
                  show={(x) => d.clientPage
                    ? <Link to={`/app/client/${x}`}><IdLine icon={MobileIcon} label={tr("kind.device")}>{x.slice(0, 10)}…</IdLine></Link>
                    : <IdLine icon={MobileIcon} label={tr("kind.device")}>{x.slice(0, 10)}…</IdLine>} />
                {d.devices.length > 0 && <Text as="p" variant="bodySm" tone="subdued">{tr("cust.deviceHint")}</Text>}
              </BlockStack>
            </Card>

            {/* data typed from the same browsers that isn't on the list yet */}
            {d.otherData.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd">{tr("cust.otherTitle")}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{tr("cust.otherHint")}</Text>
                  </BlockStack>
                  {(d.otherData as any[]).map((o) => (
                    <InlineStack key={o.kind + o.value} align="space-between" blockAlign="center" gap="200" wrap={false}>
                      <BlockStack gap="050">
                        <IdLine icon={o.kind === "email" ? EmailIcon : o.kind === "phone" ? PhoneIcon : LocationIcon} label={tr(`kind.${o.kind}` as TKey)}>{[o.value, o.city].filter(Boolean).join(", ")}</IdLine>
                        <Text as="span" variant="bodySm" tone="subdued">{when(o.last)}</Text>
                      </BlockStack>
                      <Button size="slim" loading={adder.state !== "idle" && adder.formData?.get("pick") === o.kind + o.value}
                        onClick={() => adder.submit({ pick: o.kind + o.value, ...(o.kind === "email" ? { email: o.value } : o.kind === "phone" ? { phone: o.value } : { address1: o.value, city: o.city || "" }) }, { method: "post" })}>{tr("cust.addThis")}</Button>
                    </InlineStack>
                  ))}
                  {d.otherData.length > 1 && (
                    <InlineStack align="end">
                      <Button variant="primary" loading={adder.state !== "idle" && adder.formData?.get("pick") === "all"}
                        onClick={() => adder.submit({ pick: "all", all: JSON.stringify(d.otherData.map((o: any) => ({ kind: o.kind, value: o.value, city: o.city }))) }, { method: "post" })}>{tr("cust.addAll")}</Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>
            )}

            {/* add more data to the entry */}
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">{tr("cust.addTitle")}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{tr("cust.addHint")}</Text>
                </BlockStack>
                <FormLayout>
                  <TextField label={tr("kind.email")} type="email" value={form.email} onChange={set("email")} autoComplete="off" />
                  <TextField label={tr("kind.phone")} type="tel" value={form.phone} onChange={set("phone")} autoComplete="off" />
                  <FormLayout.Group condensed>
                    <TextField label={tr("cust.firstName")} value={form.firstName} onChange={set("firstName")} autoComplete="off" />
                    <TextField label={tr("cust.lastName")} value={form.lastName} onChange={set("lastName")} autoComplete="off" />
                  </FormLayout.Group>
                  <TextField label={tr("kind.address")} value={form.address1} onChange={set("address1")} autoComplete="off" />
                  <TextField label={tr("cust.city")} value={form.city} onChange={set("city")} autoComplete="off" />
                </FormLayout>
                <InlineStack align="end">
                  <Button variant="primary" loading={adder.state !== "idle"} disabled={!Object.values(form).some((v) => v.trim())}
                    onClick={() => adder.submit(form, { method: "post" })}>{tr("cust.addSave")}</Button>
                </InlineStack>
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

          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal open={confirm} onClose={() => setConfirm(false)} title={tr("cust.removeTitle")}
        primaryAction={{ content: tr("cust.remove"), destructive: true, loading: fetcher.state !== "idle", onAction: () => fetcher.submit({ intent: "delete", id: d.entry.id }, { method: "post", action: "/app/blacklist" }) }}
        secondaryActions={[{ content: tr("common.cancel"), onAction: () => setConfirm(false) }]}>
        <Modal.Section><Text as="p">{tr("cust.removeText", { name: title })}</Text></Modal.Section>
      </Modal>
    </div>
  );
}

function Group({ label, items, icon, onRemove, removeLabel, busy, show }: {
  label: string; items: string[]; icon: any; onRemove: (x: string) => void; removeLabel: string; busy: string | null; show?: (x: string) => ReactNode;
}) {
  if (!items.length) return null;
  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
      {items.map((x) => (
        <div key={x} className="sf-cu-id">
          {show ? show(x) : <IdLine icon={icon} label={label}>{x}</IdLine>}
          <Button size="micro" variant="tertiary" tone="critical" icon={XSmallIcon} accessibilityLabel={`${removeLabel}: ${x}`} loading={busy === x} onClick={() => onRemove(x)} />
        </div>
      ))}
    </BlockStack>
  );
}
