import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, TextField, Button, Banner, List } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getShop } from "../semafor/shop.server";
import { createEntry, pushCheckoutMetafield } from "../semafor/entries.server";
import { REASONS, type Reason } from "../../core/reasons";

export const loader = async ({ request }: LoaderFunctionArgs) => { await authenticate.admin(request); return null; };

/** Accepts CSV with a header row. Recognised columns (case-insensitive): email, phone, first_name/prenume, last_name/nume, name, address/adresa, city/oras, reason/motiv, note. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await getShop(session.shop);
  if (!shop) throw new Response("shop not found", { status: 404 });
  const csv = String((await request.formData()).get("csv") || "");
  const rows = parseCsv(csv);
  if (rows.length < 2) return { ok: false, error: "CSV gol sau fără antet", imported: 0, skipped: [] as string[] };
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
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) app.toast.show(`Importate: ${fetcher.data.imported}`); }, [fetcher.state, fetcher.data, app]);
  const d = fetcher.data;
  return (
    <Page narrowWidth>
      <TitleBar title="Import CSV" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="p">Lipește conținutul unui CSV exportat din aplicația veche. Prima linie trebuie să fie antetul. Coloane recunoscute:</Text>
                <List type="bullet">
                  <List.Item><code>email</code>, <code>phone</code> / <code>telefon</code></List.Item>
                  <List.Item><code>first_name</code> + <code>last_name</code> sau <code>name</code></List.Item>
                  <List.Item><code>address</code> / <code>adresa</code>, <code>city</code> / <code>oras</code></List.Item>
                  <List.Item><code>reason</code> / <code>motiv</code> (refuz_colet, chargeback, return_fraud, abuse, other), <code>note</code></List.Item>
                </List>
                <TextField label="CSV" value={csv} onChange={setCsv} multiline={12} autoComplete="off" monospaced placeholder={"email,phone,name,reason\nion@example.com,0743000000,Ion Popescu,refuz_colet"} />
                <Button variant="primary" loading={fetcher.state !== "idle"} disabled={!csv.trim()} onClick={() => fetcher.submit({ csv }, { method: "post" })}>Importă</Button>
              </BlockStack>
            </Card>
            {d && !d.ok && <Banner tone="critical">{(d as any).error}</Banner>}
            {d && d.ok && (
              <Banner tone={d.skipped.length ? "warning" : "success"} title={`Importate: ${d.imported}`}>
                {d.skipped.length ? <>Sărite ({d.skipped.length}, fără identificator valid): <List>{d.skipped.slice(0, 20).map((s, i) => <List.Item key={i}>{s}</List.Item>)}</List></> : null}
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
