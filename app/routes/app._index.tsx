import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, TextField, Select, Button, Badge, Avatar, Divider,
  IndexTable, EmptyState, Banner, Box, Modal, FormLayout, Icon,
} from "@shopify/polaris";
import { DeleteIcon, EmailIcon, PhoneIcon, LocationIcon, MobileIcon, SearchIcon, OrderIcon } from "@shopify/polaris-icons";
import { Lamp, SignalStrip, IdLine, worst } from "../components/semafor-ui";
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
  // read-only summary for the header: order verdicts of the last 30 days (worst of own list / network)
  const since = new Date(Date.now() - 30 * 86_400_000);
  const groups = (await (db.orderCheck.groupBy as any)({ by: ["level", "networkLevel"], where: { shopId: shop.id, checkedAt: { gt: since } }, _count: { _all: true } })) as any[];
  const verdicts = { green: 0, yellow: 0, red: 0 };
  for (const g of groups) verdicts[worst(g.level, g.networkLevel)] += g._count._all;
  return { entries, total, shared, q, network: shop.settings.shareNetwork, verdicts };
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

const EMPTY_FORM = { email: "", phone: "", firstName: "", lastName: "", address1: "", city: "", reason: "refuz_colet", note: "" };
const REASON_TONE: Record<string, "critical" | "warning" | undefined> = { refuz_colet: "critical", chargeback: "critical", abuse: "critical", return_fraud: "warning", other: undefined };

function initials(s: string) {
  const parts = s.replace(/[^\p{L}\p{N}\s@.]/gu, " ").split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 && !s.includes("@") ? parts[1][0] : "")).toUpperCase();
}

export default function Index() {
  const { entries, total, shared, q, network, verdicts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const [open, setOpen] = useState(false);
  const [, setParams] = useSearchParams();
  const [search, setSearch] = useState(q);
  const [reasonFilter, setReasonFilter] = useState("");
  const [netFilter, setNetFilter] = useState("");
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const busy = fetcher.state !== "idle";
  const deletingId = busy && fetcher.formData?.get("intent") === "delete" ? String(fetcher.formData.get("id")) : null;
  const tr = useT();
  const lang = useLang();
  const reasonLabel = (r: string) => tr(`reason.${r}` as TKey);
  const sourceLabel = (s: string) => (["manual", "order", "import", "courier"].includes(s) ? tr(`source.${s}` as TKey) : s);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) { app.toast.show(tr("common.saved")); setOpen(false); setToDelete(null); setForm(EMPTY_FORM); }
      else app.toast.show((fetcher.data as any).error || tr("common.error"), { isError: true });
    }
  }, [fetcher.state, fetcher.data, app, tr]);

  const submit = () => fetcher.submit({ intent: "create", ...form }, { method: "post" });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const runSearch = () => setParams(search.trim() ? { q: search.trim() } : {});

  const rows = useMemo(() => (entries as any[])
    .filter((e) => (!reasonFilter || e.reason === reasonFilter) && (!netFilter || (netFilter === "shared" ? e.shared : !e.shared)))
    .map((e) => {
      const of = (k: string) => e.identifiers.filter((x: any) => x.kind === k).map((x: any) => x.raw as string);
      const emails = of("email"), phones = of("phone"), names = of("name"), addresses = of("address"), devices = of("device");
      const title = names[0] || emails[0] || phones[0] || addresses[0] || tr("common.customer");
      return { ...e, emails, phones, names, addresses, devices, title };
    }), [entries, reasonFilter, netFilter, tr]);

  const filtered = !!(reasonFilter || netFilter);
  const checked = verdicts.green + verdicts.yellow + verdicts.red;

  return (
    <Page fullWidth>
      <TitleBar title={tr("index.title")}>
        <button variant="primary" onClick={() => setOpen(true)}>{tr("index.addCustomer")}</button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="500">
                <div className="sf-hero">
                  <div className="sf-hero-status">
                    <Lamp size="lg" level={network ? "green" : "yellow"} label={network ? tr("dash.statusOn") : tr("dash.statusOff")} />
                    <BlockStack gap="100">
                      <Text as="h1" variant="headingLg">{network ? tr("dash.statusOn") : tr("dash.statusOff")}</Text>
                      <Text as="p" tone="subdued">{network ? tr("dash.statusOnText") : tr("dash.statusOffText")}</Text>
                    </BlockStack>
                  </div>
                  <div className="sf-hero-metrics">
                    <div className="sf-metric">
                      <Text as="p" variant="bodySm" tone="subdued">{tr("index.statBlocked")}</Text>
                      <div className="sf-metric-value">{total}</div>
                    </div>
                    <div className="sf-metric">
                      <Text as="p" variant="bodySm" tone="subdued">{tr("dash.redStopped")}</Text>
                      <div className={`sf-metric-value${verdicts.red ? " red" : ""}`}>{verdicts.red}</div>
                    </div>
                    <div className="sf-metric">
                      <Text as="p" variant="bodySm" tone="subdued">{tr("index.statShared")}</Text>
                      <div className="sf-metric-value">{shared}</div>
                    </div>
                  </div>
                </div>
                <Divider />
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingSm">{tr("dash.verdicts")}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{tr("dash.checked", { n: checked })}</Text>
                    </InlineStack>
                    <Button variant="plain" url="/app/checks" icon={OrderIcon}>{tr("dash.viewChecks")}</Button>
                  </InlineStack>
                  <SignalStrip green={verdicts.green} yellow={verdicts.yellow} red={verdicts.red}
                    labels={{ green: tr("level.green"), yellow: tr("level.yellow"), red: tr("level.red") }} emptyText={tr("dash.noChecks")} />
                </BlockStack>
              </BlockStack>
            </Card>

            {!network && <Banner tone="warning" action={{ content: tr("nav.settings"), url: "/app/settings" }}>{tr("index.networkOffBanner")}</Banner>}

            <Card padding="0">
              <Box padding="400" paddingBlockEnd="300">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">{tr("nav.blacklist")}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{filtered || q ? tr("dash.showing", { n: rows.length, total }) : tr("dash.totalCustomers", { n: total })}</Text>
                    </BlockStack>
                    <Button variant="primary" onClick={() => setOpen(true)}>{tr("index.addCustomer")}</Button>
                  </InlineStack>
                  <InlineStack gap="200" wrap blockAlign="start">
                    <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                      <form onSubmit={(ev) => { ev.preventDefault(); runSearch(); }}>
                        <TextField label={tr("common.search")} labelHidden placeholder={tr("index.searchPlaceholder")} value={search} onChange={setSearch} autoComplete="off"
                          prefix={<Icon source={SearchIcon} tone="subdued" />}
                          clearButton onClearButtonClick={() => { setSearch(""); setParams({}); }}
                          connectedRight={<Button submit>{tr("common.search")}</Button>} />
                      </form>
                    </div>
                    <div style={{ flex: "0 1 220px" }}>
                      <Select label={tr("index.colReason")} labelHidden value={reasonFilter} onChange={setReasonFilter}
                        options={[{ label: tr("dash.allReasons"), value: "" }, ...REASONS.map((r) => ({ label: reasonLabel(r), value: r }))]} />
                    </div>
                    <div style={{ flex: "0 1 200px" }}>
                      <Select label={tr("common.network")} labelHidden value={netFilter} onChange={setNetFilter}
                        options={[{ label: tr("dash.allNetwork"), value: "" }, { label: tr("dash.netShared"), value: "shared" }, { label: tr("dash.netLocal"), value: "local" }]} />
                    </div>
                  </InlineStack>
                </BlockStack>
              </Box>
              {total === 0 ? (
                <EmptyState heading={tr("index.emptyHeading")} action={{ content: tr("index.emptyAction"), onAction: () => setOpen(true) }} secondaryAction={{ content: tr("nav.import"), url: "/app/import" }} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>{tr("index.emptyText")}</p>
                </EmptyState>
              ) : rows.length === 0 ? (
                <Box padding="600">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" variant="headingSm">{q ? tr("dash.noResults", { q }) : tr("dash.noMatch")}</Text>
                    <Button onClick={() => { setReasonFilter(""); setNetFilter(""); setSearch(""); setParams({}); }}>{tr("dash.clearFilters")}</Button>
                  </BlockStack>
                </Box>
              ) : (
                <div className="sf-table sf-lg-hide-4 sf-md-hide-5 sf-md-hide-2">
                  <IndexTable resourceName={{ singular: tr("index.resSingular"), plural: tr("index.resPlural") }} itemCount={rows.length} selectable={false}
                    headings={[{ title: tr("common.customer") }, { title: tr("stats.colContact") }, { title: tr("index.colReason") }, { title: tr("index.colSource") }, { title: tr("index.colAdded") }, { title: tr("dash.actions"), hidden: true }]}>
                    {rows.map((e: any, i: number) => (
                      <IndexTable.Row id={e.id} key={e.id} position={i}>
                        <IndexTable.Cell>
                          <InlineStack gap="300" wrap={false} blockAlign="start">
                            <Avatar size="md" initials={initials(e.title)} name={e.title} />
                            <BlockStack gap="050">
                              <Text as="span" fontWeight="semibold"><span className="sf-break">{e.title}</span></Text>
                              {e.addresses.map((a: string, k: number) => <IdLine key={k} icon={LocationIcon} label={tr("kind.address")}>{a}</IdLine>)}
                              {e.names.length > 1 && <Text as="span" variant="bodySm" tone="subdued">{e.names.slice(1).join(", ")}</Text>}
                            </BlockStack>
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            {e.emails.map((x: string, k: number) => <IdLine key={"e" + k} icon={EmailIcon} label={tr("kind.email")}>{x}</IdLine>)}
                            {e.phones.map((x: string, k: number) => <IdLine key={"p" + k} icon={PhoneIcon} label={tr("kind.phone")}>{x}</IdLine>)}
                            {e.devices.length > 0 && <IdLine icon={MobileIcon} label={tr("kind.device")}>{tr("dash.devices", { n: e.devices.length })}</IdLine>}
                            {!e.emails.length && !e.phones.length && !e.devices.length && <Text as="span" tone="subdued">—</Text>}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100" inlineAlign="start">
                            <Badge tone={REASON_TONE[e.reason]}>{reasonLabel(e.reason)}</Badge>
                            {e.note ? <Text as="p" variant="bodySm" tone="subdued"><span className="sf-clamp2 sf-break" title={e.note}>{e.note}</span></Text> : null}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100" inlineAlign="start">
                            <Text as="span" variant="bodySm">{e.orderName ? `${sourceLabel(e.source)} ${e.orderName}` : sourceLabel(e.source)}</Text>
                            {e.shared && <Badge tone="info" size="small">{tr("index.reported")}</Badge>}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm"><span className="sf-nowrap">{new Date(e.createdAt).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short", year: "numeric" })}</span></Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <div className="sf-row-actions" style={{ display: "flex", justifyContent: "flex-end" }}>
                            <Button icon={DeleteIcon} variant="tertiary" tone="critical" accessibilityLabel={`${tr("common.delete")}: ${e.title}`} loading={deletingId === e.id}
                              onClick={() => setToDelete({ id: e.id, name: e.title })} />
                          </div>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </div>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title={tr("dash.deleteTitle")}
        primaryAction={{ content: tr("common.delete"), destructive: true, loading: !!deletingId, onAction: () => toDelete && fetcher.submit({ intent: "delete", id: toDelete.id }, { method: "post" }) }}
        secondaryActions={[{ content: tr("common.cancel"), onAction: () => setToDelete(null) }]}>
        <Modal.Section>
          <Text as="p">{tr("dash.deleteText", { name: toDelete?.name || "" })}</Text>
        </Modal.Section>
      </Modal>

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
