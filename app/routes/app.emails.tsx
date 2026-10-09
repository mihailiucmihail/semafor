import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Select, Button, Banner, Box, TextField, Checkbox, FormLayout, IndexTable, InlineGrid } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireFeature } from "../semafor/plan.server";
import db from "../db.server";
import { ensureShop, saveSettings } from "../semafor/shop.server";
import { ensureTemplates } from "../semafor/recovery.server";
import { render } from "../semafor/render";
import { defaultTemplates } from "../semafor/recovery-templates";

const DAY = 86_400_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
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
    resend: !!process.env.RESEND_API_KEY,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
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
    const data = { name: String(fd.get("name") || "Șablon"), locale: String(fd.get("locale") || "de"), purpose: String(fd.get("purpose") || "manual"), subject: String(fd.get("subject") || ""), html: String(fd.get("html") || "") };
    const id = String(fd.get("id") || "");
    if (id) await db.emailTemplate.updateMany({ where: { id, shopId: shop.id }, data });
    else await db.emailTemplate.create({ data: { ...data, shopId: shop.id } });
    return { ok: true, msg: "Șablon salvat" };
  }
  if (intent === "delete") {
    await db.emailTemplate.deleteMany({ where: { id: String(fd.get("id")), shopId: shop.id } });
    return { ok: true, msg: "Șablon șters" };
  }
  if (intent === "reset") {
    await db.emailTemplate.createMany({ data: defaultTemplates().map((t) => ({ ...t, name: t.name + " (nou)", shopId: shop.id })) });
    return { ok: true, msg: "Șabloanele standard au fost adăugate" };
  }
  return { ok: false, msg: "?" };
};

const PURPOSE: Record<string, string> = { manual: "manual", auto1: "automat · primul e-mail", auto2: "automat · al doilea (cu reducere)" };
const SAMPLE = {
  first_name: "Jasmin", total: "93,95 €", recovery_url: "#", discount_code: "MIA20-AB12C", discount_pct: "20", valid_until: "08.10., 23:59", shop_name: "MIA by MIHAILIUC",
  items: `<table role="presentation" width="100%" style="border-top:1px solid #eee3d6"><tr><td style="padding:10px 0;border-bottom:1px solid #eee3d6;font-family:Arial;font-size:14px">MIA DUNKLE SCHOKOLADE</td></tr></table>`,
};

export default function Emails() {
  const { recovery, templates, stats, resend } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const [r, setR] = useState({ ...recovery });
  const [edit, setEdit] = useState<any | null>(null);
  useEffect(() => { if (fetcher.state === "idle" && (fetcher.data as any)?.msg) { app.toast.show((fetcher.data as any).msg); if ((fetcher.data as any).msg !== "Setări salvate") setEdit(null); } }, [fetcher.state, fetcher.data, app]);
  const num = (v: string, d: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : d);
  const preview = edit ? render({ subject: edit.subject, html: edit.html }, SAMPLE, true) : null;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => setEdit((x: any) => ({ ...x, html: String(rd.result || "") })); rd.readAsText(f);
  }

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
                {!resend && <Banner tone="warning">Pentru trimitere e nevoie de un cont Resend (resend.com): verifici domeniul expeditorului (ex. mihailiuc.de) și pui cheia API în Railway ca RESEND_API_KEY.</Banner>}
                <FormLayout>
                  <Checkbox label="Trimite automat e-mailuri clienților care au abandonat checkout-ul" checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} />
                  <TextField label="Primul e-mail după (minute)" type="number" value={String(r.delay1Min)} onChange={(v) => setR({ ...r, delay1Min: num(v, 60) })} autoComplete="off" helpText="Recomandat: 60. Prima oră aduce cele mai multe comenzi recuperate. Noaptea (22–8, ora clientului) nu se trimite — clientul primește direct e-mailul de dimineață." />
                  <Checkbox label="Trimite și al doilea e-mail" checked={r.second} onChange={(v) => setR({ ...r, second: v })} />
                  <FormLayout.Group>
                    <Select label="Când pleacă al doilea e-mail" value={r.secondMode || "morning"} onChange={(v) => setR({ ...r, secondMode: v as any })} disabled={!r.second}
                      options={[{ label: "A doua zi dimineață (ora locală a clientului)", value: "morning" }, { label: "La un număr de ore după primul", value: "delay" }]}
                      helpText="Dimineața: toți cei care au lăsat checkout-ul ieri (sau acum 2–3 zile) și n-au comandat — inclusiv cei care n-au primit primul e-mail." />
                    {(r.secondMode || "morning") === "morning"
                      ? <Select label="Ora de trimitere" value={String(r.morningHour ?? 10)} onChange={(v) => setR({ ...r, morningHour: Number(v) })} disabled={!r.second} options={[8, 9, 10, 11, 12, 13, 14, 17, 19, 20].map((h) => ({ label: `${h}:00`, value: String(h) }))} helpText="Recomandat: 10:00 — după drumul la serviciu, cu timp de comandat în pauză." />
                      : <TextField label="Ore după primul e-mail" type="number" value={String(r.delay2Hours)} onChange={(v) => setR({ ...r, delay2Hours: num(v, 24) })} autoComplete="off" disabled={!r.second} helpText="Recomandat: 24." />}
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <Select label="Reducere în al doilea e-mail" helpText="Codul e personal, de unică folosință." value={String(r.pct2)} onChange={(v) => setR({ ...r, pct2: Number(v) })} disabled={!r.second} options={[0, 5, 10, 15, 20, 25].map((p) => ({ label: p ? `${p}%` : "fără", value: String(p) }))} />
                    <Select label="Codul e valabil" value={String(r.validHours2)} onChange={(v) => setR({ ...r, validHours2: Number(v) })} disabled={!r.second || !r.pct2} options={[{ label: "24 de ore", value: "24" }, { label: "48 de ore", value: "48" }, { label: "72 de ore", value: "72" }]} />
                  </FormLayout.Group>
                  <Checkbox label="Doar clienților care au bifat abonarea la e-mailuri" checked={r.onlyConsent} onChange={(v) => setR({ ...r, onlyConsent: v })} helpText="Recomandat pentru UE (Germania: e-mailurile de reamintire fără acord pot fi considerate publicitate nesolicitată)." />
                  <FormLayout.Group>
                    <TextField label="Nume expeditor" value={r.fromName} onChange={(v) => setR({ ...r, fromName: v })} autoComplete="off" />
                    <TextField label="E-mail expeditor" value={r.fromEmail} onChange={(v) => setR({ ...r, fromEmail: v })} autoComplete="off" placeholder="hallo@mihailiuc.de" helpText="Pe un domeniu verificat în Resend." />
                    <TextField label="Răspunsurile merg la" value={r.replyTo} onChange={(v) => setR({ ...r, replyTo: v })} autoComplete="off" placeholder="info@mihailiuc.co" />
                  </FormLayout.Group>
                </FormLayout>
                <InlineStack><Button variant="primary" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "settings"} onClick={() => fetcher.submit({ intent: "settings", recovery: JSON.stringify(r) }, { method: "post" })}>Salvează automatizarea</Button></InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">Limba e-mailului = limba checkout-ului clientului (DE / PL / RO). Nu se trimite dacă clientul a comandat între timp. Max. 2 e-mailuri automate per client în 7 zile.</Text>
              </BlockStack>
            </Card>

            <Card padding="0">
              <Box padding="400"><InlineStack align="space-between" blockAlign="center"><Text as="h2" variant="headingMd">Șabloane</Text>
                <InlineStack gap="200">
                  <Button onClick={() => fetcher.submit({ intent: "reset" }, { method: "post" })}>Adaugă șabloanele standard</Button>
                  <Button variant="primary" onClick={() => setEdit({ id: "", name: "Șablon nou", locale: "de", purpose: "manual", subject: "", html: "" })}>Șablon nou</Button>
                </InlineStack></InlineStack></Box>
              <IndexTable resourceName={{ singular: "șablon", plural: "șabloane" }} itemCount={templates.length} selectable={false} headings={[{ title: "Nume" }, { title: "Limba" }, { title: "Folosit pentru" }, { title: "Subiect" }, { title: "" }]}>
                {templates.map((t: any, i: number) => (
                  <IndexTable.Row id={t.id} key={t.id} position={i}>
                    <IndexTable.Cell><Text as="span" fontWeight="semibold">{t.name}</Text></IndexTable.Cell>
                    <IndexTable.Cell>{t.locale.toUpperCase()}</IndexTable.Cell>
                    <IndexTable.Cell>{PURPOSE[t.purpose] || t.purpose}</IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" variant="bodySm">{t.subject}</Text></IndexTable.Cell>
                    <IndexTable.Cell><InlineStack gap="200"><Button size="slim" onClick={() => setEdit({ ...t })}>Editează</Button><Button size="slim" tone="critical" variant="plain" onClick={() => fetcher.submit({ intent: "delete", id: t.id }, { method: "post" })}>Șterge</Button></InlineStack></IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>

            {edit && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">{edit.id ? "Editează șablonul" : "Șablon nou"}</Text>
                  <FormLayout>
                    <FormLayout.Group>
                      <TextField label="Nume" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} autoComplete="off" />
                      <Select label="Limba" value={edit.locale} onChange={(v) => setEdit({ ...edit, locale: v })} options={[{ label: "Germană (DE/AT)", value: "de" }, { label: "Poloneză", value: "pl" }, { label: "Română", value: "ro" }, { label: "Engleză", value: "en" }]} />
                      <Select label="Folosit pentru" value={edit.purpose} onChange={(v) => setEdit({ ...edit, purpose: v })} options={Object.entries(PURPOSE).map(([value, label]) => ({ value, label }))} />
                    </FormLayout.Group>
                    <TextField label="Subiect" value={edit.subject} onChange={(v) => setEdit({ ...edit, subject: v })} autoComplete="off" />
                    <BlockStack gap="100">
                      <Text as="p">Conținut HTML — scrie aici sau încarcă un fișier .html:</Text>
                      <input type="file" accept=".html,.htm,text/html" onChange={onFile} />
                    </BlockStack>
                    <TextField label="HTML" labelHidden value={edit.html} onChange={(v) => setEdit({ ...edit, html: v })} multiline={12} autoComplete="off" monospaced />
                    <Text as="p" variant="bodySm" tone="subdued">Câmpuri: {"{{first_name}} {{items}} {{total}} {{recovery_url}} {{discount_code}} {{discount_pct}} {{valid_until}} {{shop_name}}"} · bloc doar cu reducere: {"{{#discount}} … {{/discount}}"}</Text>
                  </FormLayout>
                  <InlineStack gap="200">
                    <Button variant="primary" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "save"} onClick={() => fetcher.submit({ intent: "save", ...edit }, { method: "post" })}>Salvează șablonul</Button>
                    <Button onClick={() => setEdit(null)}>Închide</Button>
                  </InlineStack>
                  {preview && (
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Previzualizare (date de exemplu) · Subiect: <b>{preview.subject}</b></Text>
                      <Box borderColor="border" borderWidth="025" borderRadius="200"><iframe title="preview" srcDoc={preview.html} style={{ width: "100%", height: 620, border: 0 }} /></Box>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
