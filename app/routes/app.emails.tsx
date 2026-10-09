import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Select, Button, Banner, Box, TextField, Checkbox, FormLayout, IndexTable, InlineGrid } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireFeature } from "../semafor/plan.server";
import db from "../db.server";
import { ensureShop, saveSettings } from "../semafor/shop.server";
import { ensureTemplates, mailReady, senderOf, sendMail, shopIdentity, sampleItems, brandOf, templateSource, productVars, unsubUrl, withUnsubFooter, blastFirst, unsubVars, UNSUB_PH, cartPermalink, withDiscountLink, createDiscount } from "../semafor/recovery.server";
import { DESIGNS, DEFAULT_COPY, buildEmail, productBlock, isDesign, type Item } from "../semafor/designs";
import { render } from "../semafor/render";
import { defaultTemplates } from "../semafor/recovery-templates";
import { useT, t, trMsg, type TKey } from "../i18n";
import { shopLang } from "../i18n.server";

const DAY = 86_400_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "recovery", redirect);
  await ensureTemplates(shop.id);
  const templates = (await db.emailTemplate.findMany({ where: { shopId: shop.id }, orderBy: [{ locale: "asc" }, { purpose: "asc" }, { name: "asc" }] })) as any[];
  const since = new Date(Date.now() - 30 * DAY);
  const sends = (await db.emailSend.findMany({ where: { shopId: shop.id, createdAt: { gt: since } }, select: { status: true, kind: true, email: true, createdAt: true } })) as any[];
  const sent = sends.filter((s) => s.status === "sent");
  // recovered = an e-mail we wrote to placed an order (checkout completed) after our e-mail
  const emails = [...new Set(sent.map((s) => s.email.toLowerCase()))];
  const done = emails.length ? ((await db.checkoutAttempt.findMany({ where: { shopId: shop.id, event: "completed", createdAt: { gt: since }, email: { not: null } }, select: { email: true, createdAt: true } })) as any[]).filter((d) => emails.includes(String(d.email).toLowerCase())) : [];
  const recovered = emails.filter((e) => { const first = sent.filter((s) => s.email.toLowerCase() === e).sort((a, b) => +a.createdAt - +b.createdAt)[0]; return done.some((d) => d.email?.toLowerCase() === e && +d.createdAt > +first.createdAt); }).length;
  return {
    recovery: shop.settings.recovery, templates,
    stats: { sent: sent.length, people: emails.length, recovered, skipped: sends.filter((s) => s.status === "skipped").length, failed: sends.filter((s) => s.status === "failed").length },
    resend: mailReady(),
    sender: await senderOf(session.shop, shop.settings.recovery),
    shopName: (await shopIdentity(admin as any)).name,
    sample: await sampleItems(admin as any, shop.id),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "recovery", redirect);
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const lang = shopLang(shop, request);
  if (intent === "settings") {
    const r = JSON.parse(String(fd.get("recovery")));
    await saveSettings(shop.id, { recovery: { ...shop.settings.recovery, ...r } }, (session as any).email || session.shop);
    return { ok: true, msg: t(lang, "common.settingsSaved") };
  }
  if (intent === "save") {
    const design = String(fd.get("design") || "custom");
    let copy: any = null;
    try { copy = JSON.parse(String(fd.get("copy") || "null")); } catch { copy = null; }
    const data = { name: String(fd.get("name") || "Șablon"), locale: String(fd.get("locale") || "de"), purpose: String(fd.get("purpose") || "manual"), subject: String(fd.get("subject") || ""), html: isDesign(design) ? "" : String(fd.get("html") || ""), design: isDesign(design) ? design : "custom", copy: isDesign(design) ? copy : null };
    const id = String(fd.get("id") || "");
    if (id) await db.emailTemplate.updateMany({ where: { id, shopId: shop.id }, data });
    else await db.emailTemplate.create({ data: { ...data, shopId: shop.id } });
    return { ok: true, msg: t(lang, "emails.msg.templateSaved"), closeEdit: true };
  }
  if (intent === "delete") {
    await db.emailTemplate.deleteMany({ where: { id: String(fd.get("id")), shopId: shop.id } });
    return { ok: true, msg: t(lang, "emails.msg.templateDeleted"), closeEdit: true };
  }
  if (intent === "test") {
    const to = String(fd.get("to") || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, msg: t(lang, "emails.msg.invalidEmail"), test: t(lang, "emails.msg.invalidEmail") };
    try {
      const tpl = (await db.emailTemplate.findFirst({ where: { id: String(fd.get("templateId") || ""), shopId: shop.id } }))
        || (await db.emailTemplate.findFirst({ where: { shopId: shop.id }, orderBy: { updatedAt: "desc" } }));
      if (!tpl) return { ok: false, msg: t(lang, "emails.msg.noTemplate"), test: t(lang, "emails.msg.noTemplate") };
      const s = shop.settings.recovery;
      const me = await shopIdentity(admin as any);
      const brand = brandOf(s, me.name);
      const items = await sampleItems(admin as any, shop.id);
      const pct = tpl.purpose === "auto3" ? s.pct3 : s.pct2;
      const name = s.fromName || me.name;
      // a real link: the shop, the product already in the cart and (for e-mails 2 and 3) a real one-time code applied
      const dom: any = await (await (admin as any).graphql(`query{ shop{ primaryDomain{ url } } }`)).json().catch(() => null);
      // the site of the template's language (mihailiuc.ro for RO, .de for DE…), learned from real checkouts
      const seen = (await db.checkoutAttempt.findFirst({ where: { shopId: shop.id, locale: { startsWith: tpl.locale }, host: { not: null } }, orderBy: { createdAt: "desc" }, select: { host: true } })) as any;
      const base = seen?.host ? `https://${String(seen.host).replace(/^https?:\/\//, "")}` : dom?.data?.shop?.primaryDomain?.url || `https://${session.shop}`;
      let link = cartPermalink(base, items as any);
      let code = SAMPLE.discount_code, until = SAMPLE.valid_until;
      if ((tpl.purpose === "auto2" || tpl.purpose === "auto3") && pct) {
        const d = await createDiscount(admin as any, pct, 24, "test", !!s.combineDiscounts);
        code = d.code; until = d.endsAt.toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
        link = withDiscountLink(link, code);
      }
      const out = render(templateSource(tpl as any, brand), { ...SAMPLE, recovery_url: link, discount_code: code, valid_until: until, ...unsubVars(tpl.locale, name), discount_pct: String(pct || 15), ...productVars(tpl.design, items, brand), product_title: items[0]?.title || "", shop_name: name }, tpl.purpose === "auto2" || tpl.purpose === "auto3");
      const uurl = unsubUrl(shop.id, to) + "&test=1"; // test e-mails: the page works, but nobody gets unsubscribed
      await sendMail({ to, unsubscribeUrl: uurl, subject: "[TEST] " + out.subject, html: withUnsubFooter(out.html.split(UNSUB_PH).join(uurl), uurl, tpl.locale, name), fromName: name, fromEmail: await senderOf(session.shop, s), replyTo: s.replyTo || me.email || undefined });
      const m = t(lang, "emails.msg.testSent", { to, name: tpl.name });
      return { ok: true, msg: m, test: m };
    } catch (e: any) {
      console.error("[semafor] test e-mail", e?.stack || e);
      const m = t(lang, "emails.msg.error", { e: trMsg(lang, String(e?.message || e).slice(0, 200)) });
      return { ok: false, msg: m, test: m };
    }
  }
  if (intent === "blast") {
    const days = Math.min(14, Math.max(1, Number(fd.get("days")) || 7));
    const dry = fd.get("dry") === "1";
    if (dry) {
      const r = await blastFirst(shop as any, { days, dryRun: true });
      return { ok: true, msg: t(lang, "emails.msg.blastCount", { n: r.candidates }), blast: r };
    }
    // real send runs in the background (it can take a few minutes)
    blastFirst(shop as any, { days, dryRun: false }).then((r) => console.log("[semafor] blast done", shop.domain, JSON.stringify(r))).catch((e) => console.error("[semafor] blast", e));
    return { ok: true, msg: t(lang, "emails.msg.blastStarted"), blast: null };
  }
  if (intent === "reset") {
    const d = String(fd.get("design") || "elegant");
    await db.emailTemplate.createMany({ data: defaultTemplates(isDesign(d) ? d : "elegant").map((t) => ({ ...t, shopId: shop.id })) });
    return { ok: true, msg: t(lang, "emails.msg.resetDone") };
  }
  return { ok: false, msg: "?" };
};

const PURPOSES = ["manual", "auto1", "auto2", "auto3"];
const SAMPLE: Record<string, string> = {
  first_name: "Ana", total: "", recovery_url: "#", discount_code: "SAVE10-AB12C", discount_pct: "10", valid_until: "12.10., 23:59", shop_name: "",
};
const DESIGN_NAME: Record<string, string> = Object.fromEntries(DESIGNS.map((d) => [d.id, d.name]));

/** Rendered e-mail (subject + html) for the editor preview and design thumbnails. */
function previewOf(t: any, brand: any, items: Item[], shopName: string, pcts: { p2: number; p3: number } = { p2: 15, p3: 20 }) {
  const design = isDesign(t.design) ? t.design : "elegant";
  const src = isDesign(t.design) ? { subject: t.subject, html: buildEmail(t.design, t.copy || {}, brand) } : { subject: t.subject, html: t.html };
  const pb = productBlock(design, items, brand.accent);
  const pct = t.purpose === "auto3" ? pcts.p3 : pcts.p2;
  return render(src, { ...SAMPLE, discount_pct: String(pct || 15), total: items[0]?.price || "", product_block: pb, items: pb, product_title: items[0]?.title || "", shop_name: shopName, unsubscribe_url: "#", unsubscribe_label: "Dezabonare", unsubscribe_why: `Primești acest e-mail pentru că ai început o comandă la ${shopName}.` }, t.purpose === "auto2" || t.purpose === "auto3");
}

function copyFor(locale: string, purpose: string) {
  const d = DEFAULT_COPY[locale] || DEFAULT_COPY.en;
  const { subject, ...copy } = purpose === "auto3" ? d.auto3 : purpose === "auto2" ? d.auto2 : d.auto1;
  return { subject, copy };
}

export default function Emails() {
  const { recovery, templates, stats, resend, sender, shopName, sample } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const [r, setR] = useState({ ...recovery });
  const [edit, setEdit] = useState<any | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testTpl, setTestTpl] = useState("");
  const [newDesign, setNewDesign] = useState("elegant");
  const tr = useT();
  const designName = (id: string) => DESIGN_NAME[id] || tr("emails.customHtml");
  const purposeLabel = (p: string) => (PURPOSES.includes(p) ? tr(`emails.purpose.${p}` as TKey) : p);
  useEffect(() => {
    const d = fetcher.data as any;
    if (fetcher.state === "idle" && d?.msg) {
      app.toast.show(d.msg, { isError: d.ok === false });
      if (d.ok && d.closeEdit) setEdit(null);
    }
  }, [fetcher.state, fetcher.data, app]);
  const num = (v: string, d: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : d);
  // previews update ~0.6 s after the merchant stops typing (iframes are heavy)
  const [look, setLook] = useState({ brandName: r.brandName, brandTagline: r.brandTagline, logoUrl: r.logoUrl, accent: r.accent, fromName: r.fromName });
  useEffect(() => {
    const t = setTimeout(() => setLook({ brandName: r.brandName, brandTagline: r.brandTagline, logoUrl: r.logoUrl, accent: r.accent, fromName: r.fromName }), 600);
    return () => clearTimeout(t);
  }, [r.brandName, r.brandTagline, r.logoUrl, r.accent, r.fromName]);
  const brand = useMemo(() => ({ name: look.brandName || shopName, tagline: look.brandTagline, logoUrl: look.logoUrl, accent: look.accent }), [look, shopName]);
  // stable across revalidations (otherwise every save re-renders all previews)
  const sampleKey = JSON.stringify(sample);
  const items = useMemo(() => JSON.parse(sampleKey) as Item[], [sampleKey]);
  const [showDesigns, setShowDesigns] = useState(false);
  const shownName = look.fromName || shopName;
  const [editLive, setEditLive] = useState<any>(null);
  useEffect(() => { const t = setTimeout(() => setEditLive(edit), 400); return () => clearTimeout(t); }, [edit]);
  const preview = useMemo(() => (editLive ? previewOf(editLive, brand, items, shownName, { p2: r.pct2, p3: r.pct3 }) : null), [editLive, brand, items, shownName, r.pct2, r.pct3]);
  const thumbs = useMemo(() => !showDesigns ? [] : DESIGNS.map((d) => previewOf({ design: d.id, purpose: "auto2", subject: "", copy: copyFor("ro", "auto2").copy }, brand, items, shownName).html), [brand, items, shownName, showDesigns]);
  const setCopy = (k: string, v: string) => setEdit((x: any) => ({ ...x, copy: { ...(x.copy || {}), [k]: v } }));

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => setEdit((x: any) => ({ ...x, design: "custom", html: String(rd.result || "") })); rd.readAsText(f);
  }
  function newTemplate() {
    const { subject, copy } = copyFor("ro", "auto1");
    setEdit({ id: "", name: tr("emails.newTpl"), locale: "ro", purpose: "auto1", subject, html: "", design: newDesign, copy });
  }
  const saveTemplate = () => fetcher.submit({ intent: "save", id: edit.id, name: edit.name, locale: edit.locale, purpose: edit.purpose, subject: edit.subject, html: edit.html || "", design: edit.design, copy: JSON.stringify(edit.copy || null) }, { method: "post" });

  return (
    <Page title={tr("emails.pageTitle")}>
      <TitleBar title={tr("nav.emails")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
              <Card><BlockStack gap="100"><Text as="p" tone="subdued">{tr("emails.sent30")}</Text><Text as="p" variant="heading2xl">{stats.sent}</Text><Text as="p" variant="bodySm" tone="subdued">{tr("emails.customers", { n: stats.people })}</Text></BlockStack></Card>
              <Card><BlockStack gap="100"><Text as="p" tone="subdued">{tr("emails.orderedAfter")}</Text><Text as="p" variant="heading2xl" tone="success">{stats.recovered}</Text><Text as="p" variant="bodySm" tone="subdued">{tr("emails.pctContacted", { p: stats.people ? Math.round((stats.recovered / stats.people) * 100) : 0 })}</Text></BlockStack></Card>
              <Card><BlockStack gap="100"><Text as="p" tone="subdued">{tr("emails.skipped")}</Text><Text as="p" variant="heading2xl">{stats.skipped}</Text><Text as="p" variant="bodySm" tone="subdued">{tr("emails.skippedHint")}</Text></BlockStack></Card>
              <Card><BlockStack gap="100"><Text as="p" tone="subdued">{tr("emails.errors")}</Text><Text as="p" variant="heading2xl" tone={stats.failed ? "critical" : undefined}>{stats.failed}</Text></BlockStack></Card>
            </InlineGrid>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between"><Text as="h2" variant="headingMd">{tr("emails.automation")}</Text>{r.enabled ? <Badge tone="success">{tr("emails.on")}</Badge> : <Badge>{tr("emails.off")}</Badge>}</InlineStack>
                {resend
                  ? <Banner tone="success">{tr("emails.resendA")}<b>{shownName || tr("emails.shopNamePh")} &lt;{sender}&gt;</b>{tr("emails.resendB", { to: r.replyTo || tr("emails.shopEmail") })}</Banner>
                  : <Banner tone="info">{tr("emails.soon")}</Banner>}
                <FormLayout>
                  <Checkbox label={tr("emails.enable")} checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} />
                  <TextField label={tr("emails.delay1")} type="number" value={String(r.delay1Min)} onChange={(v) => setR({ ...r, delay1Min: num(v, 60) })} autoComplete="off" helpText={tr("emails.delay1Help")} />
                  <Banner tone="info">
                    <b>{tr("emails.howTitle")}</b>{tr("emails.howBody")}
                  </Banner>
                  <Checkbox label={tr("emails.second")} checked={r.second} onChange={(v) => setR({ ...r, second: v })} />
                  <FormLayout.Group>
                    <Select label={tr("emails.secondWhen")} value={r.secondMode || "morning"} onChange={(v) => setR({ ...r, secondMode: v as any })} disabled={!r.second}
                      options={[{ label: tr("emails.secondMorning"), value: "morning" }, { label: tr("emails.secondDelay"), value: "delay" }]} />
                    {(r.secondMode || "morning") === "morning"
                      ? <Select label={tr("emails.hour2")} value={String(r.morningHour ?? 10)} onChange={(v) => setR({ ...r, morningHour: Number(v) })} disabled={!r.second} options={[8, 9, 10, 11, 12, 13, 14, 17, 19, 20].map((h) => ({ label: `${h}:00`, value: String(h) }))} helpText={tr("emails.hour2Help")} />
                      : <TextField label={tr("emails.hoursAfter")} type="number" value={String(r.delay2Hours)} onChange={(v) => setR({ ...r, delay2Hours: num(v, 24) })} autoComplete="off" disabled={!r.second} helpText={tr("emails.hoursAfterHelp")} />}
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <Select label={tr("emails.pct2")} value={String(r.pct2)} onChange={(v) => setR({ ...r, pct2: Number(v) })} disabled={!r.second} options={[0, 5, 10, 15, 20, 25].map((p) => ({ label: p ? `${p}%` : tr("emails.none"), value: String(p) }))} helpText={tr("emails.pct2Help")} />
                    <Select label={tr("emails.valid2")} value={String(r.validHours2)} onChange={(v) => setR({ ...r, validHours2: Number(v) })} disabled={!r.second || !r.pct2} options={[{ label: tr("common.h24"), value: "24" }, { label: tr("common.h48"), value: "48" }, { label: tr("common.h72"), value: "72" }]} />
                  </FormLayout.Group>
                  <Checkbox label={tr("emails.third")} checked={r.third} onChange={(v) => setR({ ...r, third: v })} disabled={!r.second} />
                  <FormLayout.Group>
                    <Select label={tr("emails.hour3")} value={String(r.thirdHour ?? 12)} onChange={(v) => setR({ ...r, thirdHour: Number(v) })} disabled={!r.second || !r.third} options={[8, 9, 10, 11, 12, 13, 14, 17, 19, 20].map((h) => ({ label: `${h}:00`, value: String(h) }))} helpText={tr("emails.hour3Help")} />
                    <Select label={tr("emails.pct3")} value={String(r.pct3)} onChange={(v) => setR({ ...r, pct3: Number(v) })} disabled={!r.second || !r.third} options={[10, 15, 20, 25, 30].map((p) => ({ label: `${p}%`, value: String(p) }))} helpText={tr("emails.pct3Help")} />
                  </FormLayout.Group>
                  <Checkbox label={tr("emails.combine")} checked={!!r.combineDiscounts} onChange={(v) => setR({ ...r, combineDiscounts: v })}
                    helpText={tr("emails.combineHelp")} />
                  <Checkbox label={tr("emails.onlyConsent")} checked={r.onlyConsent} onChange={(v) => setR({ ...r, onlyConsent: v })} helpText={tr("emails.onlyConsentHelp")} />
                  <FormLayout.Group>
                    <TextField label={tr("emails.fromName")} value={r.fromName} onChange={(v) => setR({ ...r, fromName: v })} autoComplete="off" placeholder={shopName || tr("emails.shopNamePh")} helpText={tr("emails.fromNameHelp")} />
                    <TextField label={tr("emails.replyTo")} value={r.replyTo} onChange={(v) => setR({ ...r, replyTo: v })} autoComplete="off" placeholder={tr("emails.shopEmail")} helpText={tr("emails.replyToHelp")} />
                  </FormLayout.Group>
                </FormLayout>
                <InlineStack><Button variant="primary" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "settings"} onClick={() => fetcher.submit({ intent: "settings", recovery: JSON.stringify(r) }, { method: "post" })}>{tr("emails.saveAutomation")}</Button></InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">{tr("emails.langNote")}</Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{tr("emails.blastHeading")}</Text>
                <Text as="p" tone="subdued">{tr("emails.blastText")}</Text>
                {(fetcher.data as any)?.blast && (
                  <Banner tone="info">{tr("emails.blastWill")}<b>{(fetcher.data as any).blast.candidates}</b> ({Object.entries((fetcher.data as any).blast.byLang).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(", ") || "—"}{tr("emails.blastSkipped", { o: (fetcher.data as any).blast.ordered, c: (fetcher.data as any).blast.noConsent, a: (fetcher.data as any).blast.already, u: (fetcher.data as any).blast.optedOut })}</Banner>
                )}
                <InlineStack gap="200">
                  <Button loading={fetcher.state !== "idle" && fetcher.formData?.get("dry") === "1"} onClick={() => fetcher.submit({ intent: "blast", days: "7", dry: "1" }, { method: "post" })}>{tr("emails.blastCheck")}</Button>
                  <Button variant="primary" disabled={!resend || !(fetcher.data as any)?.blast?.candidates} onClick={() => fetcher.submit({ intent: "blast", days: "7", dry: "0" }, { method: "post" })}>{tr("common.sendNow")}</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{tr("emails.lookHeading")}</Text>
                <Text as="p" tone="subdued">{tr("emails.lookText")}</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField label={tr("emails.brandName")} value={r.brandName} onChange={(v) => setR({ ...r, brandName: v })} autoComplete="off" placeholder={shopName} helpText={tr("emails.brandNameHelp")} />
                    <TextField label={tr("emails.tagline")} value={r.brandTagline} onChange={(v) => setR({ ...r, brandTagline: v })} autoComplete="off" placeholder={tr("emails.taglinePh")} />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField label={tr("emails.logo")} value={r.logoUrl} onChange={(v) => setR({ ...r, logoUrl: v.trim() })} autoComplete="off" placeholder="https://cdn.shopify.com/…/logo.png" helpText={tr("emails.logoHelp")} />
                    <TextField label={tr("emails.accent")} value={r.accent} onChange={(v) => setR({ ...r, accent: v.trim() })} autoComplete="off" placeholder="#2a1a12" prefix={<span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3, background: /^#[0-9a-f]{3,8}$/i.test(r.accent) ? r.accent : "#ddd", border: "1px solid #ccc" }} />} helpText={tr("emails.accentHelp")} />
                  </FormLayout.Group>
                </FormLayout>
                <InlineStack><Button variant="primary" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "settings"} onClick={() => fetcher.submit({ intent: "settings", recovery: JSON.stringify(r) }, { method: "post" })}>{tr("emails.saveLook")}</Button></InlineStack>
                {resend && (
                  <InlineStack gap="200" blockAlign="end" wrap>
                    <Box minWidth="260px"><TextField label={tr("emails.testTo")} value={testTo} onChange={setTestTo} autoComplete="email" placeholder={tr("emails.testToPh")} /></Box>
                    <Box minWidth="240px"><Select label={tr("common.template")} value={testTpl} onChange={setTestTpl} options={[{ label: tr("emails.firstTpl"), value: "" }, ...templates.map((t: any) => ({ label: `${t.name} · ${designName(t.design)}`, value: t.id }))]} /></Box>
                    <Button loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "test"} disabled={!testTo} onClick={() => fetcher.submit({ intent: "test", to: testTo, templateId: testTpl }, { method: "post" })}>{tr("common.sendTest")}</Button>
                  </InlineStack>
                )}
                {(fetcher.data as any)?.test && <Banner tone={(fetcher.data as any).ok ? "success" : "critical"}>{(fetcher.data as any).test}</Banner>}
                <Text as="p" variant="bodySm" tone="subdued">{tr("emails.testNote", { p: items[0] ? ` (${items[0].title})` : "" })}</Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{tr("emails.designs")}</Text>
                {!showDesigns && <InlineStack><Button onClick={() => setShowDesigns(true)}>{tr("emails.showDesigns")}</Button></InlineStack>}
                {showDesigns && <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                  {DESIGNS.map((d, di) => {
                    return (
                      <Box key={d.id} borderColor={newDesign === d.id ? "border-emphasis" : "border"} borderWidth={newDesign === d.id ? "050" : "025"} borderRadius="200" padding="200">
                        <BlockStack gap="200">
                          <div style={{ height: 300, overflow: "hidden", borderRadius: 6, position: "relative" }}>
                            <iframe title={d.name} loading="lazy" srcDoc={thumbs[di]} style={{ width: 600, height: 1000, border: 0, transform: "scale(.5)", transformOrigin: "0 0", pointerEvents: "none" }} />
                          </div>
                          <Text as="p" fontWeight="semibold">{d.name}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">{tr(`emails.design.${d.id}` as TKey)}</Text>
                          <InlineStack gap="200">
                            <Button size="slim" pressed={newDesign === d.id} onClick={() => setNewDesign(d.id)}>{newDesign === d.id ? tr("emails.chosen") : tr("emails.choose")}</Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    );
                  })}
                </InlineGrid>}
                <InlineStack gap="200">
                  <Button variant="primary" onClick={() => fetcher.submit({ intent: "reset", design: newDesign }, { method: "post" })}>{tr("emails.createIn", { d: DESIGN_NAME[newDesign] })}</Button>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">{tr("emails.createNote")}</Text>
              </BlockStack>
            </Card>

            <Card padding="0">
              <Box padding="400"><InlineStack align="space-between" blockAlign="center"><Text as="h2" variant="headingMd">{tr("emails.templates")}</Text>
                <Button variant="primary" onClick={newTemplate}>{tr("emails.newTpl")}</Button></InlineStack></Box>
              <IndexTable resourceName={{ singular: tr("emails.resTpl"), plural: tr("emails.resTpls") }} itemCount={templates.length} selectable={false} headings={[{ title: tr("common.name") }, { title: tr("emails.colDesign") }, { title: tr("emails.colLang") }, { title: tr("emails.colPurpose") }, { title: tr("common.subject") }, { title: "" }]}>
                {templates.map((t: any, i: number) => (
                  <IndexTable.Row id={t.id} key={t.id} position={i}>
                    <IndexTable.Cell><Text as="span" fontWeight="semibold">{t.name}</Text></IndexTable.Cell>
                    <IndexTable.Cell>{designName(t.design)}</IndexTable.Cell>
                    <IndexTable.Cell>{t.locale.toUpperCase()}</IndexTable.Cell>
                    <IndexTable.Cell>{purposeLabel(t.purpose)}</IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" variant="bodySm">{t.subject}</Text></IndexTable.Cell>
                    <IndexTable.Cell><InlineStack gap="200"><Button size="slim" onClick={() => setEdit({ ...t, copy: t.copy || null })}>{tr("common.edit")}</Button><Button size="slim" tone="critical" variant="plain" onClick={() => fetcher.submit({ intent: "delete", id: t.id }, { method: "post" })}>{tr("common.delete")}</Button></InlineStack></IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>

            {edit && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">{edit.id ? tr("emails.editTpl") : tr("emails.newTpl")}</Text>
                  <InlineGrid columns={{ xs: 1, lg: 2 }} gap="400">
                    <FormLayout>
                      <FormLayout.Group>
                        <TextField label={tr("common.name")} value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} autoComplete="off" />
                        <Select label={tr("emails.colDesign")} value={edit.design || "custom"} onChange={(v) => setEdit({ ...edit, design: v, copy: edit.copy || copyFor(edit.locale, edit.purpose).copy })} options={[...DESIGNS.map((d) => ({ label: d.name, value: d.id })), { label: tr("emails.customHtmlAdv"), value: "custom" }]} />
                      </FormLayout.Group>
                      <FormLayout.Group>
                        <Select label={tr("emails.colLang")} value={edit.locale} onChange={(v) => setEdit({ ...edit, locale: v })} options={[{ label: tr("emails.lang.ro"), value: "ro" }, { label: tr("emails.lang.de"), value: "de" }, { label: tr("emails.lang.pl"), value: "pl" }, { label: tr("emails.lang.en"), value: "en" }]} />
                        <Select label={tr("emails.colPurpose")} value={edit.purpose} onChange={(v) => setEdit({ ...edit, purpose: v })} options={PURPOSES.map((value) => ({ value, label: purposeLabel(value) }))} />
                      </FormLayout.Group>
                      {isDesign(edit.design) && (
                        <InlineStack><Button size="slim" variant="plain" onClick={() => { const c = copyFor(edit.locale, edit.purpose); setEdit({ ...edit, subject: c.subject, copy: c.copy }); }}>{tr("emails.stdTexts")}</Button></InlineStack>
                      )}
                      <TextField label={tr("common.subject")} value={edit.subject} onChange={(v) => setEdit({ ...edit, subject: v })} autoComplete="off" />
                      {isDesign(edit.design) ? (
                        <>
                          <TextField label={tr("emails.greeting")} value={edit.copy?.greeting || ""} onChange={(v) => setCopy("greeting", v)} autoComplete="off" />
                          <TextField label={tr("emails.heading")} value={edit.copy?.heading || ""} onChange={(v) => setCopy("heading", v)} autoComplete="off" />
                          <TextField label={tr("emails.text")} value={edit.copy?.text || ""} onChange={(v) => setCopy("text", v)} multiline={4} autoComplete="off" helpText={tr("emails.textHelp")} />
                          {(edit.purpose === "auto2" || edit.purpose === "auto3") && <TextField label={tr("emails.discountText")} value={edit.copy?.discount || ""} onChange={(v) => setCopy("discount", v)} autoComplete="off" helpText={tr("emails.discountTextHelp")} />}
                          {edit.purpose === "auto2" && <TextField label={tr("emails.existing")} value={edit.copy?.existing || ""} onChange={(v) => setCopy("existing", v)} autoComplete="off" helpText={tr("emails.existingHelp")} />}
                          <TextField label={tr("emails.button")} value={edit.copy?.button || ""} onChange={(v) => setCopy("button", v)} autoComplete="off" />
                          <TextField label={tr("emails.note")} value={edit.copy?.note || ""} onChange={(v) => setCopy("note", v)} multiline={2} autoComplete="off" />
                          <InlineStack><Button size="slim" variant="plain" onClick={() => setEdit({ ...edit, design: "custom", html: buildEmail(edit.design, edit.copy || {}, brand) })}>{tr("emails.toCustom")}</Button></InlineStack>
                        </>
                      ) : (
                        <>
                          <BlockStack gap="100">
                            <Text as="p">{tr("emails.htmlContent")}</Text>
                            <input type="file" accept=".html,.htm,text/html" onChange={onFile} />
                          </BlockStack>
                          <TextField label="HTML" labelHidden value={edit.html} onChange={(v) => setEdit({ ...edit, html: v })} multiline={12} autoComplete="off" monospaced />
                        </>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">{tr("emails.fields")}{"{{first_name}} {{product_title}} {{total}} {{discount_pct}} {{valid_until}} {{cart_discount_pct}} {{shop_name}}"}{!isDesign(edit.design) && <> · {"{{product_block}} {{items}} {{recovery_url}} {{discount_code}}"} · {tr("emails.discountBlock")}{"{{#discount}} … {{/discount}}"}</>}</Text>
                      <InlineStack gap="200">
                        <Button variant="primary" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "save"} onClick={saveTemplate}>{tr("emails.saveTpl")}</Button>
                        <Button onClick={() => setEdit(null)}>{tr("common.close")}</Button>
                      </InlineStack>
                    </FormLayout>
                    {preview && (
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">{tr("emails.previewNote")}<b>{preview.subject}</b></Text>
                        <Box borderColor="border" borderWidth="025" borderRadius="200"><iframe title="preview" srcDoc={preview.html} style={{ width: "100%", height: 760, border: 0 }} /></Box>
                      </BlockStack>
                    )}
                  </InlineGrid>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
