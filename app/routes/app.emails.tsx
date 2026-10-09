import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Select, Button, Banner, Box, TextField, Checkbox, FormLayout, IndexTable, InlineGrid } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireFeature } from "../semafor/plan.server";
import db from "../db.server";
import { ensureShop, saveSettings } from "../semafor/shop.server";
import { ensureTemplates, mailReady, senderOf, sendMail, shopIdentity, sampleItems, brandOf, templateSource, productVars } from "../semafor/recovery.server";
import { DESIGNS, DEFAULT_COPY, buildEmail, productBlock, isDesign, type Item } from "../semafor/designs";
import { render } from "../semafor/render";
import { defaultTemplates } from "../semafor/recovery-templates";

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
  if (intent === "settings") {
    const r = JSON.parse(String(fd.get("recovery")));
    await saveSettings(shop.id, { recovery: { ...shop.settings.recovery, ...r } }, (session as any).email || session.shop);
    return { ok: true, msg: "Setări salvate" };
  }
  if (intent === "save") {
    const design = String(fd.get("design") || "custom");
    let copy: any = null;
    try { copy = JSON.parse(String(fd.get("copy") || "null")); } catch { copy = null; }
    const data = { name: String(fd.get("name") || "Șablon"), locale: String(fd.get("locale") || "de"), purpose: String(fd.get("purpose") || "manual"), subject: String(fd.get("subject") || ""), html: isDesign(design) ? "" : String(fd.get("html") || ""), design: isDesign(design) ? design : "custom", copy: isDesign(design) ? copy : null };
    const id = String(fd.get("id") || "");
    if (id) await db.emailTemplate.updateMany({ where: { id, shopId: shop.id }, data });
    else await db.emailTemplate.create({ data: { ...data, shopId: shop.id } });
    return { ok: true, msg: "Șablon salvat" };
  }
  if (intent === "delete") {
    await db.emailTemplate.deleteMany({ where: { id: String(fd.get("id")), shopId: shop.id } });
    return { ok: true, msg: "Șablon șters" };
  }
  if (intent === "test") {
    const to = String(fd.get("to") || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, msg: "Adresă de e-mail invalidă" };
    const tpl = (await db.emailTemplate.findFirst({ where: { id: String(fd.get("templateId") || ""), shopId: shop.id } }))
      || (await db.emailTemplate.findFirst({ where: { shopId: shop.id }, orderBy: { purpose: "asc" } }));
    if (!tpl) return { ok: false, msg: "Nu există niciun șablon" };
    const s = shop.settings.recovery;
    const me = await shopIdentity(admin as any);
    const brand = brandOf(s, me.name);
    const items = await sampleItems(admin as any, shop.id);
    const pct = tpl.purpose === "auto3" ? s.pct3 : s.pct2;
    const out = render(templateSource(tpl as any, brand), { ...SAMPLE, discount_pct: String(pct || 15), ...productVars(tpl.design, items, brand), product_title: items[0]?.title || "", shop_name: s.fromName || me.name }, tpl.purpose === "auto2" || tpl.purpose === "auto3");
    try {
      await sendMail({ to, subject: "[TEST] " + out.subject, html: out.html, fromName: s.fromName || me.name, fromEmail: await senderOf(session.shop, s), replyTo: s.replyTo || me.email || undefined });
      return { ok: true, msg: `E-mail de test trimis la ${to}` };
    } catch (e: any) { return { ok: false, msg: String(e?.message || e).slice(0, 180) }; }
  }
  if (intent === "reset") {
    const d = String(fd.get("design") || "elegant");
    await db.emailTemplate.createMany({ data: defaultTemplates(isDesign(d) ? d : "elegant").map((t) => ({ ...t, shopId: shop.id })) });
    return { ok: true, msg: "Șabloanele standard au fost adăugate" };
  }
  return { ok: false, msg: "?" };
};

const PURPOSE: Record<string, string> = { manual: "manual", auto1: "e-mail 1 · reamintire (după ~1 oră)", auto2: "e-mail 2 · stoc limitat + reducere (ziua 2)", auto3: "e-mail 3 · ultima șansă (ziua 3)" };
const SAMPLE: Record<string, string> = {
  first_name: "Ana", total: "", recovery_url: "#", discount_code: "SAVE10-AB12C", discount_pct: "10", valid_until: "12.10., 23:59", shop_name: "",
};
const DESIGN_NAME: Record<string, string> = { ...Object.fromEntries(DESIGNS.map((d) => [d.id, d.name])), custom: "HTML propriu" };

/** Rendered e-mail (subject + html) for the editor preview and design thumbnails. */
function previewOf(t: any, brand: any, items: Item[], shopName: string, pcts: { p2: number; p3: number } = { p2: 15, p3: 20 }) {
  const design = isDesign(t.design) ? t.design : "elegant";
  const src = isDesign(t.design) ? { subject: t.subject, html: buildEmail(t.design, t.copy || {}, brand) } : { subject: t.subject, html: t.html };
  const pb = productBlock(design, items, brand.accent);
  const pct = t.purpose === "auto3" ? pcts.p3 : pcts.p2;
  return render(src, { ...SAMPLE, discount_pct: String(pct || 15), total: items[0]?.price || "", product_block: pb, items: pb, product_title: items[0]?.title || "", shop_name: shopName }, t.purpose === "auto2" || t.purpose === "auto3");
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
  useEffect(() => {
    const d = fetcher.data as any;
    if (fetcher.state === "idle" && d?.msg) {
      app.toast.show(d.msg, { isError: d.ok === false });
      if (d.ok && /Șablon/.test(d.msg)) setEdit(null);
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
  const items = sample as Item[];
  const shownName = look.fromName || shopName;
  const [editLive, setEditLive] = useState<any>(null);
  useEffect(() => { const t = setTimeout(() => setEditLive(edit), 400); return () => clearTimeout(t); }, [edit]);
  const preview = useMemo(() => (editLive ? previewOf(editLive, brand, items, shownName, { p2: r.pct2, p3: r.pct3 }) : null), [editLive, brand, items, shownName, r.pct2, r.pct3]);
  const thumbs = useMemo(() => DESIGNS.map((d) => previewOf({ design: d.id, purpose: "auto2", subject: "", copy: copyFor("ro", "auto2").copy }, brand, items, shownName).html), [brand, items, shownName]);
  const setCopy = (k: string, v: string) => setEdit((x: any) => ({ ...x, copy: { ...(x.copy || {}), [k]: v } }));

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => setEdit((x: any) => ({ ...x, design: "custom", html: String(rd.result || "") })); rd.readAsText(f);
  }
  function newTemplate() {
    const { subject, copy } = copyFor("ro", "auto1");
    setEdit({ id: "", name: "Șablon nou", locale: "ro", purpose: "auto1", subject, html: "", design: newDesign, copy });
  }
  const saveTemplate = () => fetcher.submit({ intent: "save", id: edit.id, name: edit.name, locale: edit.locale, purpose: edit.purpose, subject: edit.subject, html: edit.html || "", design: edit.design, copy: JSON.stringify(edit.copy || null) }, { method: "post" });

  return (
    <Page title="E-mailuri pentru coșuri abandonate">
      <TitleBar title="E-mailuri" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
              <Card><BlockStack gap="100"><Text as="p" tone="subdued">Trimise (30 zile)</Text><Text as="p" variant="heading2xl">{stats.sent}</Text><Text as="p" variant="bodySm" tone="subdued">{stats.people} clienți</Text></BlockStack></Card>
              <Card><BlockStack gap="100"><Text as="p" tone="subdued">Au comandat după e-mail</Text><Text as="p" variant="heading2xl" tone="success">{stats.recovered}</Text><Text as="p" variant="bodySm" tone="subdued">{stats.people ? Math.round((stats.recovered / stats.people) * 100) : 0}% din clienții contactați</Text></BlockStack></Card>
              <Card><BlockStack gap="100"><Text as="p" tone="subdued">Sărite</Text><Text as="p" variant="heading2xl">{stats.skipped}</Text><Text as="p" variant="bodySm" tone="subdued">au comandat singuri / fără acord</Text></BlockStack></Card>
              <Card><BlockStack gap="100"><Text as="p" tone="subdued">Erori</Text><Text as="p" variant="heading2xl" tone={stats.failed ? "critical" : undefined}>{stats.failed}</Text></BlockStack></Card>
            </InlineGrid>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between"><Text as="h2" variant="headingMd">Automatizare</Text>{r.enabled ? <Badge tone="success">pornită</Badge> : <Badge>oprită</Badge>}</InlineStack>
                {resend
                  ? <Banner tone="success">Trimiterea e inclusă în Semafor — nu trebuie să configurezi nimic. Expeditor: <b>{shownName || "numele magazinului"} &lt;{sender}&gt;</b>; răspunsurile clienților ajung la {r.replyTo || "e-mailul magazinului"}.</Banner>
                  : <Banner tone="info">Trimiterea e-mailurilor se activează în curând. Poți pregăti deja setările și șabloanele.</Banner>}
                <FormLayout>
                  <Checkbox label="Trimite automat e-mailuri clienților care au abandonat checkout-ul" checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} />
                  <TextField label="Primul e-mail după (minute)" type="number" value={String(r.delay1Min)} onChange={(v) => setR({ ...r, delay1Min: num(v, 60) })} autoComplete="off" helpText="Recomandat: 60. Prima oră aduce cele mai multe comenzi recuperate. Noaptea (22–8, ora clientului) nu se trimite — clientul primește direct e-mailul de dimineață." />
                  <Banner tone="info">
                    <b>Cum funcționează:</b> 1) după ~1 oră — reamintire elegantă cu produsul din coș, fără reducere; 2) a doua zi — „culoarea se epuizează”: dacă în coș avea deja o reducere (ex. din pop-up), îi amintim de ea; dacă nu, îi dăm reducerea ta; 3) a treia zi — ultima șansă cu reducerea mare, valabilă doar în ziua aceea. Se oprește imediat ce clienta comandă.
                  </Banner>
                  <Checkbox label="Trimite e-mailul 2 (a doua zi)" checked={r.second} onChange={(v) => setR({ ...r, second: v })} />
                  <FormLayout.Group>
                    <Select label="Când pleacă e-mailul 2" value={r.secondMode || "morning"} onChange={(v) => setR({ ...r, secondMode: v as any })} disabled={!r.second}
                      options={[{ label: "A doua zi, la ora aleasă (ora clientei)", value: "morning" }, { label: "La un număr de ore după primul", value: "delay" }]} />
                    {(r.secondMode || "morning") === "morning"
                      ? <Select label="Ora e-mailului 2" value={String(r.morningHour ?? 10)} onChange={(v) => setR({ ...r, morningHour: Number(v) })} disabled={!r.second} options={[8, 9, 10, 11, 12, 13, 14, 17, 19, 20].map((h) => ({ label: `${h}:00`, value: String(h) }))} helpText="Recomandat: 10:00 — dimineața au cele mai multe deschideri și comenzi." />
                      : <TextField label="Ore după primul e-mail" type="number" value={String(r.delay2Hours)} onChange={(v) => setR({ ...r, delay2Hours: num(v, 24) })} autoComplete="off" disabled={!r.second} helpText="Recomandat: 24." />}
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <Select label="Reducerea din e-mailul 2 (doar dacă în coș NU e deja o reducere)" value={String(r.pct2)} onChange={(v) => setR({ ...r, pct2: Number(v) })} disabled={!r.second} options={[0, 5, 10, 15, 20, 25].map((p) => ({ label: p ? `${p}%` : "fără", value: String(p) }))} helpText="De obicei aceeași ca în pop-up. Codul e personal, de unică folosință." />
                    <Select label="Codul din e-mailul 2 e valabil" value={String(r.validHours2)} onChange={(v) => setR({ ...r, validHours2: Number(v) })} disabled={!r.second || !r.pct2} options={[{ label: "24 de ore", value: "24" }, { label: "48 de ore", value: "48" }, { label: "72 de ore", value: "72" }]} />
                  </FormLayout.Group>
                  <Checkbox label="Trimite e-mailul 3 — ultima șansă (a treia zi)" checked={r.third} onChange={(v) => setR({ ...r, third: v })} disabled={!r.second} />
                  <FormLayout.Group>
                    <Select label="Ora e-mailului 3" value={String(r.thirdHour ?? 12)} onChange={(v) => setR({ ...r, thirdHour: Number(v) })} disabled={!r.second || !r.third} options={[8, 9, 10, 11, 12, 13, 14, 17, 19, 20].map((h) => ({ label: `${h}:00`, value: String(h) }))} helpText="Recomandat: 12:00 — pauza de prânz; clienta are tot restul zilei pentru oferta „doar azi”." />
                    <Select label="Reducerea din e-mailul 3" value={String(r.pct3)} onChange={(v) => setR({ ...r, pct3: Number(v) })} disabled={!r.second || !r.third} options={[10, 15, 20, 25, 30].map((p) => ({ label: `${p}%`, value: String(p) }))} helpText="Valabilă doar în ziua aceea, până la 23:59 (ora clientei)." />
                  </FormLayout.Group>
                  <Checkbox label="Doar clienților care au bifat abonarea la e-mailuri" checked={r.onlyConsent} onChange={(v) => setR({ ...r, onlyConsent: v })} helpText="Recomandat pentru UE (Germania: e-mailurile de reamintire fără acord pot fi considerate publicitate nesolicitată)." />
                  <FormLayout.Group>
                    <TextField label="Nume expeditor" value={r.fromName} onChange={(v) => setR({ ...r, fromName: v })} autoComplete="off" placeholder={shopName || "numele magazinului"} helpText="Gol = numele magazinului din Shopify." />
                    <TextField label="Răspunsurile merg la" value={r.replyTo} onChange={(v) => setR({ ...r, replyTo: v })} autoComplete="off" placeholder="e-mailul magazinului" helpText="Gol = e-mailul de contact al magazinului." />
                  </FormLayout.Group>
                </FormLayout>
                <InlineStack><Button variant="primary" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "settings"} onClick={() => fetcher.submit({ intent: "settings", recovery: JSON.stringify(r) }, { method: "post" })}>Salvează automatizarea</Button></InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">Limba e-mailului = limba checkout-ului clientului (DE / PL / RO). Nu se trimite dacă clientul a comandat între timp. Max. 3 e-mailuri automate per clientă.</Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Aspectul e-mailurilor</Text>
                <Text as="p" tone="subdued">Se aplică tuturor șabloanelor cu design. Poza, numele, varianta și prețul produsului din coș se pun automat în fiecare e-mail.</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField label="Numele afișat sus (logo text)" value={r.brandName} onChange={(v) => setR({ ...r, brandName: v })} autoComplete="off" placeholder={shopName} helpText="Gol = numele magazinului." />
                    <TextField label="Text mic sub nume (opțional)" value={r.brandTagline} onChange={(v) => setR({ ...r, brandTagline: v })} autoComplete="off" placeholder="ex.: piele naturală" />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField label="Logo (link la imagine, opțional)" value={r.logoUrl} onChange={(v) => setR({ ...r, logoUrl: v.trim() })} autoComplete="off" placeholder="https://cdn.shopify.com/…/logo.png" helpText="Shopify → Conținut → Fișiere → încarcă logo-ul → copiază linkul. Gol = numele de mai sus, scris frumos." />
                    <TextField label="Culoarea butonului / accent" value={r.accent} onChange={(v) => setR({ ...r, accent: v.trim() })} autoComplete="off" placeholder="#2a1a12" prefix={<span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3, background: /^#[0-9a-f]{3,8}$/i.test(r.accent) ? r.accent : "#ddd", border: "1px solid #ccc" }} />} helpText="Gol = culoarea designului." />
                  </FormLayout.Group>
                </FormLayout>
                <InlineStack><Button variant="primary" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "settings"} onClick={() => fetcher.submit({ intent: "settings", recovery: JSON.stringify(r) }, { method: "post" })}>Salvează aspectul</Button></InlineStack>
                {resend && (
                  <InlineStack gap="200" blockAlign="end" wrap>
                    <Box minWidth="260px"><TextField label="Trimite un e-mail de test la" value={testTo} onChange={setTestTo} autoComplete="email" placeholder="adresa@exemplu.ro" /></Box>
                    <Box minWidth="240px"><Select label="Șablon" value={testTpl} onChange={setTestTpl} options={[{ label: "primul șablon", value: "" }, ...templates.map((t: any) => ({ label: `${t.name} · ${DESIGN_NAME[t.design] || "HTML propriu"}`, value: t.id }))]} /></Box>
                    <Button loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "test"} disabled={!testTo} onClick={() => fetcher.submit({ intent: "test", to: testTo, templateId: testTpl }, { method: "post" })}>Trimite test</Button>
                  </InlineStack>
                )}
                <Text as="p" variant="bodySm" tone="subdued">E-mailul de test folosește un produs real din magazin{items[0] ? ` (${items[0].title})` : ""}. Salvează aspectul înainte de test.</Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Designuri</Text>
                <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                  {DESIGNS.map((d, di) => {
                    return (
                      <Box key={d.id} borderColor={newDesign === d.id ? "border-emphasis" : "border"} borderWidth={newDesign === d.id ? "050" : "025"} borderRadius="200" padding="200">
                        <BlockStack gap="200">
                          <div style={{ height: 300, overflow: "hidden", borderRadius: 6, position: "relative" }}>
                            <iframe title={d.name} loading="lazy" srcDoc={thumbs[di]} style={{ width: 600, height: 1000, border: 0, transform: "scale(.5)", transformOrigin: "0 0", pointerEvents: "none" }} />
                          </div>
                          <Text as="p" fontWeight="semibold">{d.name}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">{d.desc}</Text>
                          <InlineStack gap="200">
                            <Button size="slim" pressed={newDesign === d.id} onClick={() => setNewDesign(d.id)}>{newDesign === d.id ? "Ales" : "Alege"}</Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    );
                  })}
                </InlineGrid>
                <InlineStack gap="200">
                  <Button variant="primary" onClick={() => fetcher.submit({ intent: "reset", design: newDesign }, { method: "post" })}>Creează șabloanele în designul „{DESIGN_NAME[newDesign]}”</Button>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">Se creează câte 2 șabloane (reamintire + cu reducere) în RO, DE, PL și EN. Automatizarea folosește cel mai recent șablon salvat pentru fiecare limbă — poți șterge apoi șabloanele vechi.</Text>
              </BlockStack>
            </Card>

            <Card padding="0">
              <Box padding="400"><InlineStack align="space-between" blockAlign="center"><Text as="h2" variant="headingMd">Șabloane</Text>
                <Button variant="primary" onClick={newTemplate}>Șablon nou</Button></InlineStack></Box>
              <IndexTable resourceName={{ singular: "șablon", plural: "șabloane" }} itemCount={templates.length} selectable={false} headings={[{ title: "Nume" }, { title: "Design" }, { title: "Limba" }, { title: "Folosit pentru" }, { title: "Subiect" }, { title: "" }]}>
                {templates.map((t: any, i: number) => (
                  <IndexTable.Row id={t.id} key={t.id} position={i}>
                    <IndexTable.Cell><Text as="span" fontWeight="semibold">{t.name}</Text></IndexTable.Cell>
                    <IndexTable.Cell>{DESIGN_NAME[t.design] || "HTML propriu"}</IndexTable.Cell>
                    <IndexTable.Cell>{t.locale.toUpperCase()}</IndexTable.Cell>
                    <IndexTable.Cell>{PURPOSE[t.purpose] || t.purpose}</IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" variant="bodySm">{t.subject}</Text></IndexTable.Cell>
                    <IndexTable.Cell><InlineStack gap="200"><Button size="slim" onClick={() => setEdit({ ...t, copy: t.copy || null })}>Editează</Button><Button size="slim" tone="critical" variant="plain" onClick={() => fetcher.submit({ intent: "delete", id: t.id }, { method: "post" })}>Șterge</Button></InlineStack></IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>

            {edit && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">{edit.id ? "Editează șablonul" : "Șablon nou"}</Text>
                  <InlineGrid columns={{ xs: 1, lg: 2 }} gap="400">
                    <FormLayout>
                      <FormLayout.Group>
                        <TextField label="Nume" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} autoComplete="off" />
                        <Select label="Design" value={edit.design || "custom"} onChange={(v) => setEdit({ ...edit, design: v, copy: edit.copy || copyFor(edit.locale, edit.purpose).copy })} options={[...DESIGNS.map((d) => ({ label: d.name, value: d.id })), { label: "HTML propriu (avansat)", value: "custom" }]} />
                      </FormLayout.Group>
                      <FormLayout.Group>
                        <Select label="Limba" value={edit.locale} onChange={(v) => setEdit({ ...edit, locale: v })} options={[{ label: "Română", value: "ro" }, { label: "Germană (DE/AT)", value: "de" }, { label: "Poloneză", value: "pl" }, { label: "Engleză", value: "en" }]} />
                        <Select label="Folosit pentru" value={edit.purpose} onChange={(v) => setEdit({ ...edit, purpose: v })} options={Object.entries(PURPOSE).map(([value, label]) => ({ value, label }))} />
                      </FormLayout.Group>
                      {isDesign(edit.design) && (
                        <InlineStack><Button size="slim" variant="plain" onClick={() => { const c = copyFor(edit.locale, edit.purpose); setEdit({ ...edit, subject: c.subject, copy: c.copy }); }}>Pune textele standard pentru această limbă</Button></InlineStack>
                      )}
                      <TextField label="Subiect" value={edit.subject} onChange={(v) => setEdit({ ...edit, subject: v })} autoComplete="off" />
                      {isDesign(edit.design) ? (
                        <>
                          <TextField label="Salut" value={edit.copy?.greeting || ""} onChange={(v) => setCopy("greeting", v)} autoComplete="off" />
                          <TextField label="Titlu" value={edit.copy?.heading || ""} onChange={(v) => setCopy("heading", v)} autoComplete="off" />
                          <TextField label="Text" value={edit.copy?.text || ""} onChange={(v) => setCopy("text", v)} multiline={4} autoComplete="off" helpText="Sub text vine automat poza și numele produsului din coș." />
                          {(edit.purpose === "auto2" || edit.purpose === "auto3") && <TextField label="Text la reducerea oferită" value={edit.copy?.discount || ""} onChange={(v) => setCopy("discount", v)} autoComplete="off" helpText="Apare când îi dăm un cod nou; codul personal se afișează dedesubt." />}
                          {edit.purpose === "auto2" && <TextField label="Text dacă are deja reducere în coș" value={edit.copy?.existing || ""} onChange={(v) => setCopy("existing", v)} autoComplete="off" helpText="Apare în loc de codul nou, când clienta avea deja o reducere (ex. din pop-up). {{cart_discount_pct}} = procentul ei." />}
                          <TextField label="Buton" value={edit.copy?.button || ""} onChange={(v) => setCopy("button", v)} autoComplete="off" />
                          <TextField label="Notă mică (jos)" value={edit.copy?.note || ""} onChange={(v) => setCopy("note", v)} multiline={2} autoComplete="off" />
                          <InlineStack><Button size="slim" variant="plain" onClick={() => setEdit({ ...edit, design: "custom", html: buildEmail(edit.design, edit.copy || {}, brand) })}>Transformă în HTML propriu (avansat)</Button></InlineStack>
                        </>
                      ) : (
                        <>
                          <BlockStack gap="100">
                            <Text as="p">Conținut HTML — scrie aici sau încarcă un fișier .html:</Text>
                            <input type="file" accept=".html,.htm,text/html" onChange={onFile} />
                          </BlockStack>
                          <TextField label="HTML" labelHidden value={edit.html} onChange={(v) => setEdit({ ...edit, html: v })} multiline={12} autoComplete="off" monospaced />
                        </>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">Câmpuri: {"{{first_name}} {{product_title}} {{total}} {{discount_pct}} {{valid_until}} {{cart_discount_pct}} {{shop_name}}"}{!isDesign(edit.design) && <> · {"{{product_block}} {{items}} {{recovery_url}} {{discount_code}}"} · bloc doar cu reducere: {"{{#discount}} … {{/discount}}"}</>}</Text>
                      <InlineStack gap="200">
                        <Button variant="primary" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "save"} onClick={saveTemplate}>Salvează șablonul</Button>
                        <Button onClick={() => setEdit(null)}>Închide</Button>
                      </InlineStack>
                    </FormLayout>
                    {preview && (
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Previzualizare cu un produs din magazin · Subiect: <b>{preview.subject}</b></Text>
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
