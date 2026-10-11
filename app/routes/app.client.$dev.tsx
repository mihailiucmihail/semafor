import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, InlineGrid, Text, Badge, Select, Button, Banner, Box, Divider, Thumbnail, Avatar } from "@shopify/polaris";
import { EmailIcon, PhoneIcon, LocationIcon, GlobeIcon } from "@shopify/polaris-icons";
import { Dot, IdLine, SectionHead } from "../components/semafor-ui";
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
  const navigate = useNavigate();
  const lang = useLang();
  useEffect(() => { if (fetcher.state === "idle" && d && !d.preview && d.ok) app.toast.show(tr("client.sentToast", { to: d.to })); }, [fetcher.state, d, app, tr]);

  const consentBadge = ctx.acceptsMarketing || consent === "SUBSCRIBED"
    ? <Badge tone="success">{tr("client.consentYes")}</Badge>
    : <Badge tone="warning">{tr("client.consentNo")}</Badge>;
  const name = [ctx.firstName, ctx.lastName].filter(Boolean).join(" ") || ctx.email || tr("common.customer");

  const phone = (ctx as any).phone || ctx.steps.map((x: any) => x.phone).find(Boolean) || "";
  const initials = (name.split(/[\s@.]+/).filter(Boolean).slice(0, name.includes("@") ? 1 : 2).map((w: string) => w[0]).join("") || "?").toUpperCase();

  return (
    <Page fullWidth backAction={{ content: tr("common.back"), onAction: () => (window.history.length > 1 ? navigate(-1) : navigate("/app/stats")) }} title={name} subtitle={[ctx.city, ctx.country, locale.toUpperCase()].filter(Boolean).join(", ")}
      titleMetadata={ctx.completed ? <Badge tone="success">{tr("common.ordered")}</Badge> : <Badge tone="attention">{tr(`stopped.${stoppedStep(ctx.events)}` as TKey)}</Badge>}>
      <TitleBar title={name} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <SectionHead title={tr("client.steps")} />
                <ol className="sf-timeline">
                  {ctx.steps.map((s: any, i: number) => {
                    const last = i === ctx.steps.length - 1;
                    return (
                      <li key={i}>
                        <Dot level={last ? (ctx.completed ? "green" : "yellow") : "none"} />
                        <InlineStack align="space-between" gap="200" blockAlign="start">
                          <BlockStack gap="050">
                            <Text as="span" fontWeight="semibold">{STEP_LABEL[s.event] ? tr(`step.${s.event}` as TKey) : s.event}</Text>
                            {[s.email, s.phone, s.name, s.city].some(Boolean) && <Text as="span" variant="bodySm" tone="subdued"><span className="sf-break">{[s.email, s.phone, s.name, s.city].filter(Boolean).join(", ")}</span></Text>}
                          </BlockStack>
                          <Text as="span" tone="subdued" variant="bodySm"><span className="sf-nowrap sf-num">{fmt(s.at, lang)}</span></Text>
                        </InlineStack>
                      </li>
                    );
                  })}
                </ol>
                {!ctx.completed && <Text as="p" variant="bodySm" tone="subdued">{tr("client.lastStep", { date: fmt(ctx.lastAt, lang) })}</Text>}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <SectionHead title={tr("client.sendEmail")}>{ctx.email ? consentBadge : null}</SectionHead>
                {!ctx.email ? (
                  <Banner tone="info">{tr("client.noEmail")}</Banner>
                ) : (
                  <BlockStack gap="300">
                    {!ready.resend && <Banner tone="info">{tr("client.sendingSoon")}</Banner>}
                    {!(ctx.acceptsMarketing || consent === "SUBSCRIBED") && <Banner tone="warning">{tr("client.noConsentWarn")}</Banner>}
                    <Text as="p">{tr("client.to")}<b>{ctx.email}</b>{(ctx as any).emailFromPopup ? <> <Badge tone="magic">{tr("popup.badge")}</Badge></> : null}</Text>
                    <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                      <Select label={tr("common.template")} value={tpl} onChange={setTpl} options={sorted.map((t: any) => ({ label: `${t.name}`, value: t.id }))} />
                      <Select label={tr("client.discount")} value={pct} onChange={setPct} options={[{ label: tr("client.noDiscount"), value: "0" }, ...[5, 10, 15, 20, 25].map((p) => ({ label: `${p}%`, value: String(p) }))]} />
                      <Select label={tr("client.valid")} value={hours} onChange={setHours} disabled={pct === "0"} options={[{ label: tr("client.todayOnly"), value: "today" }, { label: tr("common.h24"), value: "24" }, { label: tr("common.h48"), value: "48" }, { label: tr("common.d7"), value: "168" }]} />
                    </InlineGrid>
                    <InlineStack gap="200" align="end">
                      <Button onClick={() => fetcher.submit({ intent: "preview", templateId: tpl, pct, hours: String(hoursNum) }, { method: "post" })} loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "preview"}>{tr("client.preview")}</Button>
                      <Button variant="primary" icon={EmailIcon} disabled={!ready.resend || !ready.from} onClick={() => fetcher.submit({ intent: "send", templateId: tpl, pct, hours: String(hoursNum) }, { method: "post" })} loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "send"}>{tr("common.sendNow")}</Button>
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
                <BlockStack gap="300">
                  <SectionHead title={tr("client.sentList")} />
                  {sends.map((s: any, i: number) => (
                    <BlockStack key={s.id} gap="200">
                      {i > 0 && <Divider />}
                      <InlineStack gap="300" blockAlign="center">
                        <Badge tone={s.status === "sent" ? "success" : s.status === "failed" ? "critical" : undefined}>{s.status === "sent" ? tr("client.status.sent") : s.status === "failed" ? tr("client.status.failed") : tr("client.status.skipped")}</Badge>
                        <Text as="span" variant="bodySm" tone="subdued"><span className="sf-num">{fmt(s.createdAt, lang)}</span></Text>
                      </InlineStack>
                      <Text as="p" variant="bodySm"><span className="sf-break">{KINDS.includes(s.kind) ? tr(`client.kind.${s.kind}` as TKey) : s.kind} · {s.subject}{s.discountCode ? ` · ${s.discountCode}` : ""}{s.error ? ` · ${trMsg(lang, s.error)}` : ""}</span></Text>
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
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center" wrap={false}>
                  <Avatar size="lg" initials={initials} name={name} />
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd"><span className="sf-break">{name}</span></Text>
                    {ctx.email ? consentBadge : null}
                  </BlockStack>
                </InlineStack>
                {(ctx as any).popup && (
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="magic">{tr("popup.badge")}</Badge>
                    <Text as="span" variant="bodySm" tone="subdued"><span className="sf-break">{tr("popup.clientLinked", { email: (ctx as any).popup.email, date: fmt((ctx as any).popup.createdAt, lang) })}</span></Text>
                  </InlineStack>
                )}
                <Divider />
                <BlockStack gap="150">
                  {ctx.email && <IdLine icon={EmailIcon} label={tr("kind.email")}>{ctx.email}</IdLine>}
                  {phone && <IdLine icon={PhoneIcon} label={tr("kind.phone")}>{phone}</IdLine>}
                  {(ctx.city || ctx.country) && <IdLine icon={LocationIcon} label={tr("kind.address")}>{[ctx.city, ctx.country].filter(Boolean).join(", ")}</IdLine>}
                  <IdLine icon={GlobeIcon} label={tr("emails.colLang")}>{locale.toUpperCase()}</IdLine>
                </BlockStack>
              </BlockStack>
            </Card>

            {ctx.items?.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingSm">{tr("client.inCart")}</Text>
                  {ctx.items.map((it: any, i: number) => (
                    <InlineStack key={i} gap="300" blockAlign="center" wrap={false}>
                      {it.image ? <Thumbnail source={it.image} alt="" size="small" /> : null}
                      <Text as="span"><span className="sf-break">{it.title}{it.qty > 1 ? ` × ${it.qty}` : ""}</span></Text>
                    </InlineStack>
                  ))}
                  {ctx.total != null && <><Divider /><Text as="p" fontWeight="semibold">{tr("client.total", { total: ctx.total, currency: ctx.currency })}</Text></>}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
