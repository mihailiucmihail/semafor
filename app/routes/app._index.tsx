import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, TextField, Select, Button, Badge,
  IndexTable, EmptyState, Banner, Box, Modal, FormLayout,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShop } from "../semafor/shop.server";
import { createEntry, deleteEntry, pushCheckoutMetafield } from "../semafor/entries.server";
import { REASONS, type Reason } from "../../core/reasons";

const REASON_LABEL: Record<Reason, string> = {
  refuz_colet: "Refuz colet (ramburs)",
  chargeback: "Chargeback",
  return_fraud: "Retur fraudulos",
  abuse: "Amenințări / abuz",
  other: "Altul",
};
const KIND_LABEL: Record<string, string> = { email: "E-mail", phone: "Telefon", name: "Nume", address: "Adresă", name_address: "Nume+adresă", device: "Dispozitiv" };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getShop(session.shop);
  if (!shop) throw new Response("shop not found", { status: 404 });
  const q = new URL(request.url).searchParams.get("q")?.trim() || "";
  const entries = await db.blockEntry.findMany({
    where: { shopId: shop.id, ...(q ? { identifiers: { some: { OR: [{ raw: { contains: q, mode: "insensitive" } }, { normalized: { contains: q.toLowerCase() } }] } } } : {}) },
    include: { identifiers: { select: { kind: true, raw: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const total = await db.blockEntry.count({ where: { shopId: shop.id } });
  const shared = await db.blockEntry.count({ where: { shopId: shop.id, shared: true } });
  return { entries, total, shared, q, network: shop.settings.shareNetwork };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await getShop(session.shop);
  if (!shop) throw new Response("shop not found", { status: 404 });
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const actor = (session as any).email || session.shop;
  try {
    if (intent === "create") {
      await createEntry({
        shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, actor,
        input: {
          email: str(fd, "email"), phone: str(fd, "phone"), firstName: str(fd, "firstName"), lastName: str(fd, "lastName"),
          address1: str(fd, "address1"), city: str(fd, "city"), reason: (str(fd, "reason") as Reason) || "other", note: str(fd, "note"),
        },
      });
    } else if (intent === "delete") {
      await deleteEntry(shop.id, shop.domain, String(fd.get("id")), actor);
    }
    await pushCheckoutMetafield(admin, shop.id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Eroare" };
  }
};

function str(fd: FormData, k: string) { const v = fd.get(k); return typeof v === "string" && v.trim() ? v.trim() : undefined; }

export default function Index() {
  const { entries, total, shared, q, network } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const [open, setOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(q);
  const [form, setForm] = useState({ email: "", phone: "", firstName: "", lastName: "", address1: "", city: "", reason: "refuz_colet", note: "" });
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) { app.toast.show("Salvat"); setOpen(false); setForm({ email: "", phone: "", firstName: "", lastName: "", address1: "", city: "", reason: "refuz_colet", note: "" }); }
      else app.toast.show((fetcher.data as any).error || "Eroare", { isError: true });
    }
  }, [fetcher.state, fetcher.data, app]);

  const submit = () => fetcher.submit({ intent: "create", ...form }, { method: "post" });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Page>
      <TitleBar title="Semafor — Lista neagră">
        <button variant="primary" onClick={() => setOpen(true)}>Adaugă client</button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineStack gap="400">
              <Stat label="Clienți blocați" value={total} />
              <Stat label="Raportați în rețea" value={shared} />
              <Stat label="Rețea" value={network ? "activă" : "oprită"} />
            </InlineStack>
            {!network && <Banner tone="warning">Rețeaua este oprită: nu vezi semaforul altor magazine și nu raportezi. Pornește-o din Setări.</Banner>}
            <Card padding="0">
              <Box padding="300">
                <TextField label="Caută" labelHidden placeholder="e-mail, telefon, nume…" value={search} onChange={setSearch} autoComplete="off" clearButton onClearButtonClick={() => { setSearch(""); setParams({}); }}
                  connectedRight={<Button onClick={() => setParams(search ? { q: search } : {})}>Caută</Button>} />
              </Box>
              {entries.length === 0 ? (
                <EmptyState heading="Lista este goală" action={{ content: "Adaugă primul client", onAction: () => setOpen(true) }} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>Adaugă manual, din pagina comenzii sau importă un CSV din aplicația veche.</p>
                </EmptyState>
              ) : (
                <IndexTable resourceName={{ singular: "client", plural: "clienți" }} itemCount={entries.length} selectable={false}
                  headings={[{ title: "Identificatori" }, { title: "Motiv" }, { title: "Sursă" }, { title: "Rețea" }, { title: "Adăugat" }, { title: "" }]}>
                  {entries.map((e: any, i: number) => (
                    <IndexTable.Row id={e.id} key={e.id} position={i}>
                      <IndexTable.Cell>
                        <BlockStack gap="050">
                          {e.identifiers.filter((x: any) => x.kind !== "name_address").map((x: any, k: number) => (
                            <Text key={k} as="span" variant="bodySm"><Text as="span" tone="subdued">{KIND_LABEL[x.kind]}: </Text>{x.raw}</Text>
                          ))}
                        </BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell><Badge tone={e.reason === "other" ? undefined : "critical"}>{REASON_LABEL[e.reason as Reason]}</Badge>{e.note ? <Text as="p" variant="bodySm" tone="subdued">{e.note}</Text> : null}</IndexTable.Cell>
                      <IndexTable.Cell>{e.orderName || e.source}</IndexTable.Cell>
                      <IndexTable.Cell>{e.shared ? <Badge tone="attention">raportat</Badge> : <Text as="span" tone="subdued">—</Text>}</IndexTable.Cell>
                      <IndexTable.Cell>{new Date(e.createdAt).toLocaleDateString("ro-RO")}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button size="slim" tone="critical" variant="plain" loading={busy} onClick={() => fetcher.submit({ intent: "delete", id: e.id }, { method: "post" })}>Șterge</Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal open={open} onClose={() => setOpen(false)} title="Adaugă client în lista neagră"
        primaryAction={{ content: "Salvează", onAction: submit, loading: busy }}
        secondaryActions={[{ content: "Anulează", onAction: () => setOpen(false) }]}>
        <Modal.Section>
          <FormLayout>
            <FormLayout.Group>
              <TextField label="E-mail" value={form.email} onChange={set("email")} autoComplete="off" type="email" />
              <TextField label="Telefon" value={form.phone} onChange={set("phone")} autoComplete="off" type="tel" helpText="07xx…, +40…, 0040… — se normalizează automat" />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Prenume" value={form.firstName} onChange={set("firstName")} autoComplete="off" />
              <TextField label="Nume" value={form.lastName} onChange={set("lastName")} autoComplete="off" />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Adresă (stradă + nr.)" value={form.address1} onChange={set("address1")} autoComplete="off" />
              <TextField label="Oraș" value={form.city} onChange={set("city")} autoComplete="off" />
            </FormLayout.Group>
            <Select label="Motiv" options={REASONS.map((r) => ({ label: REASON_LABEL[r], value: r }))} value={form.reason} onChange={set("reason")} />
            <TextField label="Notă (opțional)" value={form.note} onChange={set("note")} autoComplete="off" multiline={2} />
            <Text as="p" tone="subdued" variant="bodySm">Numele singur nu blochează comanda (doar avertizează). E-mailul, telefonul sau nume + adresă blochează.</Text>
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="span" tone="subdued" variant="bodySm">{label}</Text>
        <Text as="span" variant="headingLg">{value}</Text>
      </BlockStack>
    </Card>
  );
}
