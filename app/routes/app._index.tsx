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
import { ensureShop } from "../semafor/shop.server";
import { createEntry, deleteEntry, pushCheckoutMetafield } from "../semafor/entries.server";
import { REASONS, type Reason } from "../../core/reasons";
import { useT, useLang, dateLocale, t, trMsg, type TKey } from "../i18n";
import { shopLang } from "../i18n.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
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
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
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
    const lang = shopLang(shop, request);
    return { ok: false, error: e?.message ? trMsg(lang, e.message) : t(lang, "common.error") };
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
  const tr = useT();
  const lang = useLang();
  const reasonLabel = (r: string) => tr(`reason.${r}` as TKey);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) { app.toast.show(tr("common.saved")); setOpen(false); setForm({ email: "", phone: "", firstName: "", lastName: "", address1: "", city: "", reason: "refuz_colet", note: "" }); }
      else app.toast.show((fetcher.data as any).error || tr("common.error"), { isError: true });
    }
  }, [fetcher.state, fetcher.data, app, tr]);

  const submit = () => fetcher.submit({ intent: "create", ...form }, { method: "post" });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Page>
      <TitleBar title={tr("index.title")}>
        <button variant="primary" onClick={() => setOpen(true)}>{tr("index.addCustomer")}</button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineStack gap="400">
              <Stat label={tr("index.statBlocked")} value={total} />
              <Stat label={tr("index.statShared")} value={shared} />
              <Stat label={tr("common.network")} value={network ? tr("index.networkOn") : tr("index.networkOff")} />
            </InlineStack>
            {!network && <Banner tone="warning">{tr("index.networkOffBanner")}</Banner>}
            <Card padding="0">
              <Box padding="300">
                <TextField label={tr("common.search")} labelHidden placeholder={tr("index.searchPlaceholder")} value={search} onChange={setSearch} autoComplete="off" clearButton onClearButtonClick={() => { setSearch(""); setParams({}); }}
                  connectedRight={<Button onClick={() => setParams(search ? { q: search } : {})}>{tr("common.search")}</Button>} />
              </Box>
              {entries.length === 0 ? (
                <EmptyState heading={tr("index.emptyHeading")} action={{ content: tr("index.emptyAction"), onAction: () => setOpen(true) }} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>{tr("index.emptyText")}</p>
                </EmptyState>
              ) : (
                <IndexTable resourceName={{ singular: tr("index.resSingular"), plural: tr("index.resPlural") }} itemCount={entries.length} selectable={false}
                  headings={[{ title: tr("index.colIdentifiers") }, { title: tr("index.colReason") }, { title: tr("index.colSource") }, { title: tr("common.network") }, { title: tr("index.colAdded") }, { title: "" }]}>
                  {entries.map((e: any, i: number) => (
                    <IndexTable.Row id={e.id} key={e.id} position={i}>
                      <IndexTable.Cell>
                        <BlockStack gap="050">
                          {e.identifiers.filter((x: any) => x.kind !== "name_address").map((x: any, k: number) => (
                            <Text key={k} as="span" variant="bodySm"><Text as="span" tone="subdued">{tr(`kind.${x.kind}` as TKey)}: </Text>{x.raw}</Text>
                          ))}
                        </BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell><Badge tone={e.reason === "other" ? undefined : "critical"}>{reasonLabel(e.reason)}</Badge>{e.note ? <Text as="p" variant="bodySm" tone="subdued">{e.note}</Text> : null}</IndexTable.Cell>
                      <IndexTable.Cell>{e.orderName || e.source}</IndexTable.Cell>
                      <IndexTable.Cell>{e.shared ? <Badge tone="attention">{tr("index.reported")}</Badge> : <Text as="span" tone="subdued">—</Text>}</IndexTable.Cell>
                      <IndexTable.Cell>{new Date(e.createdAt).toLocaleDateString(dateLocale(lang))}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button size="slim" tone="critical" variant="plain" loading={busy} onClick={() => fetcher.submit({ intent: "delete", id: e.id }, { method: "post" })}>{tr("common.delete")}</Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal open={open} onClose={() => setOpen(false)} title={tr("index.modalTitle")}
        primaryAction={{ content: tr("common.save"), onAction: submit, loading: busy }}
        secondaryActions={[{ content: tr("common.cancel"), onAction: () => setOpen(false) }]}>
        <Modal.Section>
          <FormLayout>
            <FormLayout.Group>
              <TextField label={tr("index.email")} value={form.email} onChange={set("email")} autoComplete="off" type="email" />
              <TextField label={tr("index.phone")} value={form.phone} onChange={set("phone")} autoComplete="off" type="tel" helpText={tr("index.phoneHelp")} />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label={tr("index.firstName")} value={form.firstName} onChange={set("firstName")} autoComplete="off" />
              <TextField label={tr("index.lastName")} value={form.lastName} onChange={set("lastName")} autoComplete="off" />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label={tr("index.address")} value={form.address1} onChange={set("address1")} autoComplete="off" />
              <TextField label={tr("index.city")} value={form.city} onChange={set("city")} autoComplete="off" />
            </FormLayout.Group>
            <Select label={tr("index.reason")} options={REASONS.map((r) => ({ label: reasonLabel(r), value: r }))} value={form.reason} onChange={set("reason")} />
            <TextField label={tr("index.note")} value={form.note} onChange={set("note")} autoComplete="off" multiline={2} />
            <Text as="p" tone="subdued" variant="bodySm">{tr("index.nameHint")}</Text>
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
