import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, TextField, Button, Banner, List, DropZone } from "@shopify/polaris";
import { ImportIcon } from "@shopify/polaris-icons";
import { SectionHead } from "../components/semafor-ui";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../semafor/shop.server";
import { createEntry, pushCheckoutMetafield } from "../semafor/entries.server";
import { REASONS, type Reason } from "../../core/reasons";
import { useT, t } from "../i18n";
import { shopLang } from "../i18n.server";

export const loader = async ({ request }: LoaderFunctionArgs) => { await authenticate.admin(request); return null; };

/** Accepts CSV with a header row. Recognised columns (case-insensitive): email, phone, first_name/prenume, last_name/nume, name, address/adresa, city/oras, reason/motiv, note. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const csv = String((await request.formData()).get("csv") || "");
  const rows = parseCsv(csv);
  if (rows.length < 2) return { ok: false, error: t(shopLang(shop, request), "import.emptyCsv"), imported: 0, skipped: [] as string[] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const ci = { email: col(["email", "e-mail"]), phone: col(["phone", "telefon", "tel"]), first: col(["first_name", "firstname", "prenume"]), last: col(["last_name", "lastname", "nume"]), name: col(["name", "customer", "client"]), addr: col(["address", "address1", "adresa", "adresă"]), city: col(["city", "oras", "oraș"]), reason: col(["reason", "motiv"]), note: col(["note", "nota", "notă", "comment"]) };
  let imported = 0; const skipped: string[] = [];
  for (const r of rows.slice(1)) {
    const g = (i: number) => (i >= 0 ? (r[i] || "").trim() : "");
    let first = g(ci.first), last = g(ci.last);
    if (!first && !last && g(ci.name)) { const p = g(ci.name).split(/\s+/); first = p[0]; last = p.slice(1).join(" "); }
    const reasonRaw = g(ci.reason).toLowerCase();
    const reason: Reason = (REASONS as string[]).includes(reasonRaw) ? (reasonRaw as Reason) : /refuz|ramburs|cod/.test(reasonRaw) ? "refuz_colet" : /charge/.test(reasonRaw) ? "chargeback" : "other";
    try {
      await createEntry({ shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, actor: (session as any).email || session.shop,
        input: { email: g(ci.email), phone: g(ci.phone), firstName: first, lastName: last, address1: g(ci.addr), city: g(ci.city), reason, note: g(ci.note), source: "import" } });
      imported++;
    } catch { skipped.push(r.join(",").slice(0, 60)); }
  }
  await pushCheckoutMetafield(admin, shop.id);
  return { ok: true, imported, skipped };
};

function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  const sep = text.includes(";") && !text.split("\n")[0].includes(",") ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); if (row.some((x) => x.trim())) out.push(row); row = []; cur = ""; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) out.push(row);
  return out;
}

export default function Import() {
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const tr = useT();
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) app.toast.show(tr("import.imported", { n: fetcher.data.imported })); }, [fetcher.state, fetcher.data, app, tr]);
  const d = fetcher.data;
  const onDrop = (_all: File[], accepted: File[]) => {
    const f = accepted[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => { setCsv(String(rd.result || "")); setFileName(f.name); }; rd.readAsText(f);
  };
  const lines = csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0;
  return (
    <Page fullWidth>
      <TitleBar title={tr("import.title")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <SectionHead title={tr("import.title")} description={tr("import.lead")} />
                <DropZone accept=".csv,text/csv,text/plain" type="file" allowMultiple={false} onDrop={onDrop} label={tr("import.dropLabel")} labelHidden>
                  <DropZone.FileUpload actionTitle={tr("import.dropAction")} actionHint={fileName || tr("import.dropHint")} />
                </DropZone>
                <TextField label={tr("import.pasteLabel")} value={csv} onChange={setCsv} multiline={12} autoComplete="off" monospaced placeholder={"email,phone,name,reason\nion@example.com,0743000000,Ion Popescu,refuz_colet"}
                  helpText={lines > 0 ? tr("import.rows", { n: lines }) : undefined} />
                <InlineStack align="end">
                  <Button variant="primary" icon={ImportIcon} loading={fetcher.state !== "idle"} disabled={!csv.trim()} onClick={() => fetcher.submit({ csv }, { method: "post" })}>{tr("import.button")}</Button>
                </InlineStack>
              </BlockStack>
            </Card>
            {d && !d.ok && <Banner tone="critical">{(d as any).error}</Banner>}
            {d && d.ok && (
              <Banner tone={d.skipped.length ? "warning" : "success"} title={tr("import.imported", { n: d.imported })} action={{ content: tr("nav.blacklist"), url: "/app" }}>
                {d.skipped.length ? <>{tr("import.skipped", { n: d.skipped.length })}<List>{d.skipped.slice(0, 20).map((s, i) => <List.Item key={i}>{s}</List.Item>)}</List></> : null}
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">{tr("import.columns")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{tr("import.intro")}</Text>
              <List type="bullet">
                <List.Item><code>email</code>, <code>phone</code> / <code>telefon</code></List.Item>
                <List.Item><code>first_name</code> + <code>last_name</code> {tr("import.or")} <code>name</code></List.Item>
                <List.Item><code>address</code> / <code>adresa</code>, <code>city</code> / <code>oras</code></List.Item>
                <List.Item><code>reason</code> / <code>motiv</code> (refuz_colet, chargeback, return_fraud, return_no_reason, abuse, other), <code>note</code></List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
