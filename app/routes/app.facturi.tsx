import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useSearchParams, useRevalidator } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, TextField, Select, Button, Banner, Badge, Divider, Box, Checkbox } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { isOwnerShop } from "../semafor/plan.server";
import { ensureShop, saveSettings } from "../semafor/shop.server";
import type { SmartBillSettings } from "../../core/settings";
import { ORDER_FIELDS, draftOf, invoiceOf, issueInvoice, markInvoice, testConnection, smartbillReady, type SbDraft, type SbInvoice } from "../semafor/smartbill.server";

// Owner-only page (Russian, the owner's language): SmartBill invoices in the order's currency (RON for mihailiuc.ro).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  if (!isOwnerShop(session.shop)) throw new Response("Not found", { status: 404 });
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const sp = new URL(request.url).searchParams;
  const sb = shop.settings.smartbill ?? null;
  const after = sp.get("after") || null;
  const r: any = await (await admin.graphql(`query($after:String){ orders(first: 50, after: $after, reverse: true, sortKey: CREATED_AT, query: "status:any"){ pageInfo{ hasNextPage endCursor } nodes{ ${ORDER_FIELDS} } } }`, { variables: { after } })).json();
  const nodes = (r?.data?.orders?.nodes ?? []) as any[];
  const rows = nodes.map((o) => ({ draft: draftOf(o), invoice: invoiceOf(o) }));
  return {
    rows, next: r?.data?.orders?.pageInfo?.hasNextPage ? r.data.orders.pageInfo.endCursor : null, first: !after,
    sb: sb ? { username: sb.username, cif: sb.cif, series: sb.series, auto: sb.auto || "off", autoSince: sb.autoSince || null, currencies: (sb.currencies ?? []).join(", "), tokenSet: !!sb.token } : null,
    ready: smartbillReady(shop.settings),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  if (!isOwnerShop(session.shop)) throw new Response("Not found", { status: 404 });
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const actor = (session as any).email || session.shop;
  try {
    if (intent === "save") {
      const old = shop.settings.smartbill;
      const auto = (["off", "fulfilled", "delivered"].includes(String(fd.get("auto"))) ? String(fd.get("auto")) : "off") as SmartBillSettings["auto"];
      const next: SmartBillSettings = {
        username: String(fd.get("username") || "").trim(),
        token: String(fd.get("token") || "").trim() || old?.token || "",
        cif: String(fd.get("cif") || "").trim().replace(/^RO/i, ""),
        series: String(fd.get("series") || "").trim().toUpperCase(),
        auto,
        // switching automatic mode on starts it from now: older orders (the backlog) are issued by hand
        autoSince: auto === "off" ? null : old?.auto && old.auto !== "off" && old.autoSince ? old.autoSince : new Date().toISOString(),
        currencies: String(fd.get("currencies") || "").split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean),
      };
      await saveSettings(shop.id, { smartbill: next }, actor);
      return { ok: true, msg: "Сохранено" };
    }
    const sb = shop.settings.smartbill;
    if (intent === "test") {
      if (!sb || !smartbillReady(shop.settings)) return { ok: false, msg: "Сначала заполни и сохрани данные SmartBill" };
      const t = await testConnection(sb);
      return { ok: true, msg: `Подключение работает. Ставки НДС в SmartBill: ${t.map((x) => `${x.name} ${x.percentage}%`).join(", ") || "—"}` };
    }
    if (intent === "issue") {
      const inv = await issueInvoice(admin as any, shop, String(fd.get("orderId")), { force: fd.get("force") === "1" });
      return { ok: true, msg: `Выписана фактура ${inv.series}${inv.number} на ${inv.total} ${inv.currency}` };
    }
    if (intent === "bulk") {
      const ids = String(fd.get("ids") || "").split(",").filter(Boolean).slice(0, 50);
      const done: string[] = [], failed: string[] = [];
      for (const id of ids) {
        try { const inv = await issueInvoice(admin as any, shop, id); done.push(`${inv.series}${inv.number}`); }
        catch (e: any) { failed.push(`${id.split("/").pop()}: ${e?.message || e}`); }
      }
      return { ok: failed.length === 0, msg: `Выписано: ${done.length}${done.length ? ` (${done[0]}…${done[done.length - 1]})` : ""}${failed.length ? `. Ошибки: ${failed.join("; ")}` : ""}` };
    }
    if (intent === "mark") {
      const m = /^([A-Za-z]+)\s*-?\s*(\d+)$/.exec(String(fd.get("inv") || "").trim());
      if (!m) return { ok: false, msg: "Номер фактуры в виде MG3194" };
      const inv = await markInvoice(admin as any, shop.id, String(fd.get("orderId")), m[1].toUpperCase(), m[2]);
      return { ok: true, msg: `Заказ отмечен: фактура ${inv.series}${inv.number}` };
    }
    return { ok: false, msg: "?" };
  } catch (e: any) {
    return { ok: false, msg: String(e?.message || e) };
  }
};

const money = (n: number, c: string) => `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c === "RON" ? "lei" : c}`;
const date = (s: string) => new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });

function Row({ draft: d, invoice, onPdf }: { draft: SbDraft; invoice: SbInvoice | null; onPdf: (x: string) => void }) {
  const f = useFetcher<typeof action>();
  const [open, setOpen] = useState(false);
  const [mark, setMark] = useState("");
  const [confirm, setConfirm] = useState(false);
  const busy = f.state !== "idle";
  const inv = invoice || (f.data?.ok && /фактура (\S+)/.exec(f.data.msg || "") ? { series: "", number: /фактура (\S+)/.exec(f.data!.msg)![1] } as any : null);
  const ship = d.status.delivered ? <Badge tone="success">доставлен</Badge> : /^fulfilled$/i.test(d.status.fulfillment) ? <Badge tone="info">отправлен</Badge> : <Badge>{d.status.fulfillment.toLowerCase() || "—"}</Badge>;
  return (
    <Box paddingBlock="200">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
          <InlineStack gap="300" blockAlign="center">
            <Text as="span" fontWeight="semibold">{d.name}</Text>
            <Text as="span" tone="subdued">{date(d.createdAt)}</Text>
            <Text as="span">{d.client.name}</Text>
            <Text as="span" fontWeight="medium">{money(d.orderTotal, d.currency)}</Text>
            {ship}
            {d.status.cancelled && <Badge tone="critical">отменён</Badge>}
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            {inv ? (
              <>
                <Badge tone="success">{`${inv.series}${inv.number}`}</Badge>
                {invoice && !invoice.manual && <Button variant="plain" onClick={() => onPdf(`${invoice.series}${invoice.number}`)}>PDF</Button>}
              </>
            ) : (
              <>
                {!d.ok && <Badge tone="warning">проверить</Badge>}
                <Button size="slim" onClick={() => setOpen(!open)}>{open ? "Скрыть" : "Предпросмотр"}</Button>
                {!confirm
                  ? <Button size="slim" variant="primary" disabled={d.status.cancelled} onClick={() => setConfirm(true)}>Выписать</Button>
                  : <Button size="slim" variant="primary" tone="critical" loading={busy} onClick={() => { setConfirm(false); f.submit({ intent: "issue", orderId: d.orderId, force: d.ok ? "0" : "1" }, { method: "post" }); }}>{`Точно? ${money(d.total, d.currency)}`}</Button>}
              </>
            )}
          </InlineStack>
        </InlineStack>
        {f.data && <Text as="p" tone={f.data.ok ? "success" : "critical"}>{f.data.msg}</Text>}
        {open && !inv && (
          <Box padding="300" background="bg-surface-secondary" borderRadius="200">
            <BlockStack gap="150">
              {d.problems.map((p) => <Text key={p} as="p" tone="critical">⚠ {p}</Text>)}
              <Text as="p" tone="subdued">{`${d.client.name} · ${d.client.address}, ${d.client.city}, ${d.client.county}, ${d.client.country} · ${d.client.email}`}</Text>
              {d.lines.map((l, i) => (
                <BlockStack key={i} gap="050">
                  <InlineStack align="space-between"><Text as="span">{`${l.name} × ${l.qty}`}</Text><Text as="span">{money(l.qty * l.price, d.currency)}</Text></InlineStack>
                  {l.discount ? <InlineStack align="space-between"><Text as="span" tone="subdued">{`Discount ${l.name}`}</Text><Text as="span" tone="subdued">{`−${money(l.discount, d.currency)}`}</Text></InlineStack> : null}
                </BlockStack>
              ))}
              <Divider />
              <InlineStack align="space-between"><Text as="span" fontWeight="semibold">{`Итого (НДС ${d.taxPct}% включён)`}</Text><Text as="span" fontWeight="semibold">{money(d.total, d.currency)}</Text></InlineStack>
              <Text as="p" tone="subdued">{`Упоминание на фактуре: «Comanda ${d.name}». Дата фактуры — сегодня.`}</Text>
              <InlineStack gap="200" blockAlign="end">
                <div style={{ width: 160 }}><TextField label="Уже выписана вручную?" placeholder="MG3194" value={mark} onChange={setMark} autoComplete="off" /></div>
                <Button disabled={!mark} loading={busy} onClick={() => f.submit({ intent: "mark", orderId: d.orderId, inv: mark }, { method: "post" })}>Отметить</Button>
              </InlineStack>
            </BlockStack>
          </Box>
        )}
      </BlockStack>
    </Box>
  );
}

export default function Facturi() {
  const d = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const app = useAppBridge();
  const rv = useRevalidator();
  const save = useFetcher<typeof action>();
  const bulk = useFetcher<typeof action>();
  const [s, setS] = useState<Record<string, string>>({ username: d.sb?.username || "", token: "", cif: d.sb?.cif || "", series: d.sb?.series || "MG", auto: d.sb?.auto || "off", currencies: d.sb?.currencies ?? "RON" });
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  useEffect(() => { if (save.state === "idle" && save.data?.ok) app.toast.show(save.data.msg); }, [save.state, save.data, app]);
  useEffect(() => { if (bulk.state === "idle" && bulk.data) rv.revalidate(); }, [bulk.state, bulk.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = d.rows.filter((r) => !onlyOpen || !r.invoice);
  const bulkIds = d.rows.filter((r) => !r.invoice && r.draft.ok && (r.draft.status.delivered || /^fulfilled$/i.test(r.draft.status.fulfillment)) && (!d.sb?.currencies || d.sb.currencies.split(/[\s,]+/).includes(r.draft.currency))).map((r) => r.draft.orderId);
  const onPdf = async (x: string) => {
    try {
      const res = await fetch(`/app/facturi/pdf?n=${encodeURIComponent(x)}`);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = `${x}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { app.toast.show(`PDF не скачался: ${e?.message || e}`, { isError: true }); }
  };
  return (
    <Page title="Фактуры SmartBill" subtitle="Фактуры в валюте заказа (лей для mihailiuc.ro), а не в евро магазина">
      <TitleBar title="Фактуры SmartBill" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Подключение SmartBill</Text>
              {!d.ready && <Banner tone="info">Токен API — в SmartBill: Contul meu → Integrări → «Token API». Введи логин (e-mail), токен и CIF фирмы сам, я токены не ввожу.</Banner>}
              <InlineStack gap="300" wrap>
                <div style={{ minWidth: 220 }}><TextField label="Логин SmartBill (e-mail)" value={s.username} onChange={(v) => setS({ ...s, username: v })} autoComplete="off" /></div>
                <div style={{ minWidth: 220 }}><TextField label="Токен API" type="password" value={s.token} placeholder={d.sb?.tokenSet ? "сохранён — оставь пустым" : ""} onChange={(v) => setS({ ...s, token: v })} autoComplete="new-password" /></div>
                <div style={{ width: 140 }}><TextField label="CIF фирмы" value={s.cif} onChange={(v) => setS({ ...s, cif: v })} autoComplete="off" /></div>
                <div style={{ width: 90 }}><TextField label="Серия" value={s.series} onChange={(v) => setS({ ...s, series: v })} autoComplete="off" /></div>
              </InlineStack>
              <InlineStack gap="300" wrap blockAlign="end">
                <div style={{ minWidth: 300 }}>
                  <Select label="Автоматически" value={s.auto} onChange={(v) => setS({ ...s, auto: v })} options={[
                    { label: "Выключено — выписываю кнопкой", value: "off" },
                    { label: "Когда заказ отправлен", value: "fulfilled" },
                    { label: "Когда FAN Courier доставил", value: "delivered" },
                  ]} helpText={d.sb?.autoSince ? `Только для заказов после ${new Date(d.sb.autoSince).toLocaleString("ru-RU")}` : "Автоматически — только для новых заказов, старые выписываются кнопкой"} />
                </div>
                <div style={{ width: 160 }}><TextField label="Только валюты" value={s.currencies} onChange={(v) => setS({ ...s, currencies: v })} autoComplete="off" helpText="пусто = все" /></div>
              </InlineStack>
              <InlineStack gap="200">
                <Button variant="primary" loading={save.state !== "idle" && save.formData?.get("intent") === "save"} onClick={() => save.submit({ intent: "save", ...s }, { method: "post" })}>Сохранить</Button>
                <Button disabled={!d.ready} loading={save.state !== "idle" && save.formData?.get("intent") === "test"} onClick={() => save.submit({ intent: "test" }, { method: "post" })}>Проверить подключение</Button>
              </InlineStack>
              {save.data && <Text as="p" tone={save.data.ok ? "success" : "critical"}>{save.data.msg}</Text>}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Заказы</Text>
                <InlineStack gap="300" blockAlign="center">
                  <Checkbox label="Только без фактуры" checked={onlyOpen} onChange={setOnlyOpen} />
                  {d.ready && bulkIds.length > 0 && (!bulkConfirm
                    ? <Button onClick={() => setBulkConfirm(true)}>{`Выписать все готовые на странице (${bulkIds.length})`}</Button>
                    : <InlineStack gap="200">
                        <Button variant="primary" tone="critical" loading={bulk.state !== "idle"} onClick={() => { setBulkConfirm(false); bulk.submit({ intent: "bulk", ids: bulkIds.join(",") }, { method: "post" }); }}>{`Да, выписать ${bulkIds.length} фактур`}</Button>
                        <Button onClick={() => setBulkConfirm(false)}>Отмена</Button>
                      </InlineStack>)}
                </InlineStack>
              </InlineStack>
              {bulk.data && <Banner tone={bulk.data.ok ? "success" : "warning"}>{bulk.data.msg}</Banner>}
              {!d.ready && <Text as="p" tone="subdued">Предпросмотр работает и без подключения — можно сверить суммы.</Text>}
              <Divider />
              {rows.length === 0 && <Text as="p" tone="subdued">Нет заказов без фактуры на этой странице.</Text>}
              {rows.map((r) => <div key={r.draft.orderId}><Row draft={r.draft} invoice={r.invoice} onPdf={onPdf} /><Divider /></div>)}
              <InlineStack gap="200">
                {!d.first && <Button onClick={() => { const p = new URLSearchParams(sp); p.delete("after"); setSp(p); }}>← В начало</Button>}
                {d.next && <Button onClick={() => { const p = new URLSearchParams(sp); p.set("after", d.next!); setSp(p); }}>Старее →</Button>}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
