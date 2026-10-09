import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Select, Button, Banner, Box, Divider, Thumbnail } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireFeature } from "../semafor/plan.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";
import { deviceContext, enrichFromShopify, ensureTemplates, consentOf, localeOf, sendRecovery, mailReady, sentEmailHtml } from "../semafor/recovery.server";
import { STEP_LABEL, stoppedStep } from "../semafor/render";
import { useT, useLang, dateLocale, trMsg, type Lang, type TKey } from "../i18n";
import { shopLang } from "../i18n.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "recovery", redirect);
  await enrichFromShopify(admin as any, shop.id, 14).catch(() => 0);
  await ensureTemplates(shop.id);
  const dev = String(params.dev || "");
  const ctx = await deviceContext(shop.id, dev);
  if (!ctx) throw new Response("Not found", { status: 404 });
  const consent = ctx.email ? await consentOf(admin as any, ctx.email) : null;
  const templates = (await db.emailTemplate.findMany({ where: { shopId: shop.id }, orderBy: [{ locale: "asc" }, { purpose: "asc" }], select: { id: true, name: true, locale: true, purpose: true } })) as any[];
  const sends = ctx.email ? ((await db.emailSend.findMany({ where: { shopId: shop.id, OR: [{ deviceId: dev }, { email: ctx.email }] }, orderBy: { createdAt: "desc" }, take: 20 })) as any[]) : [];
  // the e-mails as they looked (latest 5 sent)
  let shown = 0;
  for (const x of sends) { if (x.status === "sent" && shown < 5) { const h = await sentEmailHtml(x); x.view = h ? h.replace(/https?:\/\/[^"'\s>]*\/unsub\?t=[^"'\s>]*/g, "#") : null; shown++; } delete x.html; }
  const r = shop.settings.recovery;
  return {
    dev,
    ctx: { ...ctx, steps: ctx.steps.map((s: any) => ({ event: s.event, at: s.createdAt, email: s.email, phone: s.phone, name: [s.firstName, s.lastName].filter(Boolean).join(" "), city: s.city })) },
    locale: localeOf(ctx), consent, templates, sends,
    ready: { resend: mailReady() || (!!process.env.RESEND_API_KEY && !!r.fromEmail), from: true },
  };
};

const KINDS = ["manual", "auto1", "auto2", "auto3"];

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "recovery", redirect);
  const fd = await request.formData();
  const preview = fd.get("intent") === "preview";
  try {
    const out = await sendRecovery({
      shopId: shop.id, shopDomain: session.shop, admin: admin as any, deviceId: String(params.dev), templateId: String(fd.get("templateId")),
      pct: Number(fd.get("pct")) || 0, validHours: Number(fd.get("hours")) || 24, kind: "manual", preview, settings: shop.settings.recovery,
    });
    return { ok: true, preview, ...out };
  } catch (e: any) {
    return { ok: false, preview, error: trMsg(shopLang(shop, request), String(e?.message || e)) };
  }
};

const fmt = (d: string | Date, lang: Lang) => new Date(d).toLocaleString(dateLocale(lang), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function Client() {
  const { ctx, locale, consent, templates, sends, ready } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const sorted = useMemo(() => [...templates].sort((a: any, b: any) => (a.locale === locale ? -1 : 0) - (b.locale === locale ? -1 : 0)), [templates, locale]);
  const [tpl, setTpl] = useState<string>(sorted.find((t: any) => t.locale === locale && t.purpose === "auto2")?.id || sorted[0]?.id || "");
  const [pct, setPct] = useState("20");
  const [hours, setHours] = useState("today");
  const hoursNum = hours === "today" ? Math.max(1, Math.ceil((new Date(new Date().setHours(23, 59, 0, 0)).getTime() - Date.now()) / 3_600_000)) : Number(hours);
  const d: any = fetcher.data;
  const tr = useT();
  const lang = useLang();
  useEffect(() => { if (fetcher.state === "idle" && d && !d.preview && d.ok) app.toast.show(tr("client.sentToast", { to: d.to })); }, [fetcher.state, d, app, tr]);

  const consentBadge = ctx.acceptsMarketing || consent === "SUBSCRIBED"
    ? <Badge tone="success">{tr("client.consentYes")}</Badge>
    : <Badge tone="warning">{tr("client.consentNo")}</Badge>;
  const name = [ctx.firstName, ctx.lastName].filter(Boolean).join(" ") || ctx.email || tr("common.customer");

  return (
    <Page backAction={{ content: tr("nav.stats"), url: "/app/stats" }} title={name} subtitle={[ctx.city, ctx.country, locale.toUpperCase()].filter(Boolean).join(" · ")}>
      <TitleBar title={name} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{tr("client.steps")}</Text>
                  {ctx.completed ? <Badge tone="success">{tr("common.ordered")}</Badge> : <Badge tone="attention">{tr(`stopped.${stoppedStep(ctx.events)}` as TKey)}</Badge>}
                </InlineStack>
                <BlockStack gap="200">
                  {ctx.steps.map((s: any, i: number) => (
                    <InlineStack key={i} gap="300" blockAlign="start" wrap={false}>
                      <Box minWidth="130px"><Text as="span" tone="subdued" variant="bodySm">{fmt(s.at, lang)}</Text></Box>
                      <BlockStack gap="050">
                        <Text as="span" fontWeight="semibold">{i + 1}. {STEP_LABEL[s.event] ? tr(`step.${s.event}` as TKey) : s.event}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{[s.email, s.phone, s.name, s.city].filter(Boolean).join(" · ")}</Text>
                      </BlockStack>
                    </InlineStack>
                  ))}
                </BlockStack>
                {!ctx.completed && <Text as="p" variant="bodySm" tone="subdued">{tr("client.lastStep", { date: fmt(ctx.lastAt, lang) })}</Text>}
              </BlockStack>
            </Card>

            {ctx.items?.length > 0 && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">{tr("client.inCart")}</Text>
                  {ctx.items.map((it: any, i: number) => (
                    <InlineStack key={i} gap="300" blockAlign="center">
                      {it.image ? <Thumbnail source={it.image} alt="" size="small" /> : null}
                      <Text as="span">{it.title}{it.qty > 1 ? ` × ${it.qty}` : ""}</Text>
                    </InlineStack>
                  ))}
                  {ctx.total != null && <Text as="p" fontWeight="semibold">{tr("client.total", { total: ctx.total, currency: ctx.currency })}</Text>}
                </BlockStack>
              </Card>
            )}

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{tr("client.sendEmail")}</Text>
                  {ctx.email ? consentBadge : null}
                </InlineStack>
                {!ctx.email ? (
                  <Banner tone="info">{tr("client.noEmail")}</Banner>
                ) : (
                  <BlockStack gap="300">
                    {!ready.resend && <Banner tone="info">{tr("client.sendingSoon")}</Banner>}
                    {!(ctx.acceptsMarketing || consent === "SUBSCRIBED") && <Banner tone="warning">{tr("client.noConsentWarn")}</Banner>}
                    <Text as="p">{tr("client.to")}<b>{ctx.email}</b></Text>
                    <Select label={tr("common.template")} value={tpl} onChange={setTpl} options={sorted.map((t: any) => ({ label: `${t.name}`, value: t.id }))} />
                    <InlineStack gap="300">
                      <Box minWidth="200px"><Select label={tr("client.discount")} value={pct} onChange={setPct} options={[{ label: tr("client.noDiscount"), value: "0" }, ...[5, 10, 15, 20, 25].map((p) => ({ label: `${p}%`, value: String(p) }))]} /></Box>
                      <Box minWidth="200px"><Select label={tr("client.valid")} value={hours} onChange={setHours} disabled={pct === "0"} options={[{ label: tr("client.todayOnly"), value: "today" }, { label: tr("common.h24"), value: "24" }, { label: tr("common.h48"), value: "48" }, { label: tr("common.d7"), value: "168" }]} /></Box>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Button onClick={() => fetcher.submit({ intent: "preview", templateId: tpl, pct, hours: String(hoursNum) }, { method: "post" })} loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "preview"}>{tr("client.preview")}</Button>
                      <Button variant="primary" disabled={!ready.resend || !ready.from} onClick={() => fetcher.submit({ intent: "send", templateId: tpl, pct, hours: String(hoursNum) }, { method: "post" })} loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "send"}>{tr("common.sendNow")}</Button>
                    </InlineStack>
                    {d && !d.ok && <Banner tone="critical">{d.error}</Banner>}
                    {d && d.ok && (
                      <BlockStack gap="200">
                        {!d.preview && <Banner tone="success">{tr("client.sentTo", { to: d.to })}{d.code ? tr("client.code", { code: d.code }) : ""}</Banner>}
                        <Text as="p" variant="bodySm" tone="subdued">{tr("common.subjectPrefix")}<b>{d.subject}</b></Text>
                        <Box borderColor="border" borderWidth="025" borderRadius="200" overflowX="hidden" overflowY="hidden">
                          <iframe title="preview" srcDoc={d.html} style={{ width: "100%", height: 640, border: 0, background: "#f3eee6" }} />
                        </Box>
                      </BlockStack>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {sends.length > 0 && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">{tr("client.sentList")}</Text>
                  {sends.map((s: any) => (
                    <BlockStack key={s.id} gap="200">
                      <InlineStack gap="300" blockAlign="center">
                        <Box minWidth="130px"><Text as="span" variant="bodySm" tone="subdued">{fmt(s.createdAt, lang)}</Text></Box>
                        <Badge tone={s.status === "sent" ? "success" : s.status === "failed" ? "critical" : undefined}>{s.status === "sent" ? tr("client.status.sent") : s.status === "failed" ? tr("client.status.failed") : tr("client.status.skipped")}</Badge>
                        <Text as="span" variant="bodySm">{KINDS.includes(s.kind) ? tr(`client.kind.${s.kind}` as TKey) : s.kind} · {s.subject}{s.discountCode ? ` · ${s.discountCode}` : ""}{s.error ? ` · ${trMsg(lang, s.error)}` : ""}</Text>
                      </InlineStack>
                      {s.view && (
                        <Box borderColor="border" borderWidth="025" borderRadius="200" overflowX="hidden" overflowY="hidden">
                          <iframe title={s.subject} srcDoc={s.view} loading="lazy" style={{ width: "100%", height: 620, border: 0 }} />
                        </Box>
                      )}
                    </BlockStack>
                  ))}
                </BlockStack>
              </Card>
            )}
            <Divider />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
