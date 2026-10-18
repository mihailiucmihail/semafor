import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useOutlet, useParams, useSearchParams } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, TextField, Select, Button, Badge, Avatar,
  IndexTable, EmptyState, Banner, Box, Modal, FormLayout, Icon, ButtonGroup,
} from "@shopify/polaris";
import { DeleteIcon, EmailIcon, PhoneIcon, LocationIcon, MobileIcon, SearchIcon } from "@shopify/polaris-icons";
import { IdLine, Lamp } from "../components/semafor-ui";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";
import { createEntry, deleteEntry, findExisting, pushCheckoutMetafield } from "../semafor/entries.server";
import { REASONS, type Reason } from "../../core/reasons";
import { useT, useLang, dateLocale, t, trMsg, type TKey } from "../i18n";
import { shopLang } from "../i18n.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const q = new URL(request.url).searchParams.get("q")?.trim() || "";
  const entries = await db.blockEntry.findMany({
    where: { shopId: shop.id, ...(q ? { identifiers: { some: { OR: [{ raw: { contains: q, mode: "insensitive" } }, { normalized: { contains: q.toLowerCase() } }] } } } : {}) },
    include: { identifiers: { select: { kind: true, raw: true, normalized: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const total = await db.blockEntry.count({ where: { shopId: shop.id } });
  const shared = await db.blockEntry.count({ where: { shopId: shop.id, shared: true } });
  // activity per customer: checkout tries from their browsers / e-mails (90 days) and Semafor checks that matched them
  const devOf = new Map<string, string>(), mailOf = new Map<string, string>();
  for (const e of entries) for (const i of e.identifiers) {
    if (i.kind === "device") devOf.set(i.normalized, e.id);
    if (i.kind === "email") mailOf.set(i.raw.toLowerCase(), e.id);
  }
  const act = new Map<string, { tries: number; last: number; checks: number }>();
  const bump = (id: string | undefined, at: Date, k: "tries" | "checks") => {
    if (!id) return;
    const a = act.get(id) ?? { tries: 0, last: 0, checks: 0 };
    a[k]++; a.last = Math.max(a.last, +at); act.set(id, a);
  };
  const since90 = new Date(Date.now() - 90 * 86_400_000);
  if (devOf.size || mailOf.size) {
    const tries = (await db.checkoutAttempt.findMany({
      where: { shopId: shop.id, createdAt: { gt: since90 }, event: { not: "cart" }, OR: [...(devOf.size ? [{ deviceId: { in: [...devOf.keys()] } }] : []), ...(mailOf.size ? [{ email: { in: [...mailOf.keys()], mode: "insensitive" as const } }] : [])] },
      select: { deviceId: true, email: true, createdAt: true }, take: 5000,
    })) as any[];
    for (const t of tries) bump(devOf.get(t.deviceId) ?? mailOf.get(String(t.email || "").toLowerCase()), t.createdAt, "tries");
  }
  const checks = (await db.orderCheck.findMany({
    where: { shopId: shop.id, checkedAt: { gt: new Date(Date.now() - 365 * 86_400_000) }, NOT: { level: "green" } },
    select: { matched: true, checkedAt: true }, take: 5000,
  })) as any[];
  const inList = new Set(entries.map((e) => e.id));
  for (const c of checks) {
    const ids = new Set(((c.matched as any[]) || []).map((m) => m?.entryId).filter((x: any) => x && inList.has(x)));
    for (const id of ids) bump(id as string, c.checkedAt, "checks");
  }
  const reasons = (await (db.blockEntry.groupBy as any)({ by: ["reason"], where: { shopId: shop.id }, _count: { _all: true } })) as any[];
  const added7 = await db.blockEntry.count({ where: { shopId: shop.id, createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) } } });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const activity = Object.fromEntries([...act].map(([k, v]) => [k, v]));
  const triedToday = [...act.values()].filter((a) => a.tries && a.last >= +today).length;

  const url = new URL(request.url);
  const net = url.searchParams.get("net");
  return { entries, total, shared, q, activity, added7, triedToday, reasonCounts: Object.fromEntries(reasons.map((r) => [r.reason, r._count._all])), network: shop.settings.shareNetwork, net: net === "shared" || net === "local" ? net : "", add: url.searchParams.get("add") === "1" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const actor = (session as any).email || session.shop;
  try {
    if (intent === "create") {
      const input = {
        email: str(fd, "email"), phone: str(fd, "phone"), firstName: str(fd, "firstName"), lastName: str(fd, "lastName"),
        address1: str(fd, "address1"), city: str(fd, "city"), reason: (str(fd, "reason") as Reason) || "other", note: str(fd, "note"),
      };
      // same e-mail / phone / name + address already on the list → ask before adding a duplicate
      if (fd.get("force") !== "1") {
        const existing = await findExisting(shop.id, input, shop.country);
        if (existing.length) {
          return { ok: false, duplicate: existing.slice(0, 5).map((e) => ({ reason: e.reason, createdAt: e.createdAt, orderName: e.orderName, matched: e.matched })) };
        }
      }
      await createEntry({ shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: shop.settings, actor, input });
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
const REASON_BAND: Record<string, string> = { return_no_reason: "amber", refuz_colet: "red", chargeback: "amber", abuse: "red", return_fraud: "gray", other: "gray" };
const REASON_TONE: Record<string, "critical" | "warning" | undefined> = { return_no_reason: "warning", refuz_colet: "critical", chargeback: "critical", abuse: "critical", return_fraud: "warning", other: undefined };

function initials(s: string) {
  const parts = s.replace(/[^\p{L}\p{N}\s@.]/gu, " ").split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 && !s.includes("@") ? parts[1][0] : "")).toUpperCase();
}

export default function Index() {
  const { entries, total, shared, q, network, net, add, activity, added7, triedToday, reasonCounts } = useLoaderData<typeof loader>();
  // cards (default) or the table; remembered per browser
  const [view, setView] = useState<"cards" | "table">("cards");
  useEffect(() => { try { if (window.localStorage.getItem("sf-bl-view") === "table") setView("table"); } catch { /* storage blocked */ } }, []);
  // a customer is open (child route /app/blacklist/:id) → list on the left, dossier on the right
  const outlet = useOutlet();
  const openId = useParams().id;
  const pickView = (v: "cards" | "table") => { setView(v); try { window.localStorage.setItem("sf-bl-view", v); } catch { /* storage blocked */ } };
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const [open, setOpen] = useState(add);
  const [, setParams] = useSearchParams();
  const [search, setSearch] = useState(q);
  const [reasonFilter, setReasonFilter] = useState("");
  const [netFilter, setNetFilter] = useState(net);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // earlier entries of the same customer, returned by the server instead of saving a duplicate
  const [dup, setDup] = useState<any[] | null>(null);
  const busy = fetcher.state !== "idle";
  const deletingId = busy && fetcher.formData?.get("intent") === "delete" ? String(fetcher.formData.get("id")) : null;
  const tr = useT();
  const lang = useLang();
  const reasonLabel = (r: string) => tr(`reason.${r}` as TKey);
  const sourceLabel = (s: string) => (["manual", "order", "import", "courier"].includes(s) ? tr(`source.${s}` as TKey) : s);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) { app.toast.show(tr("common.saved")); setOpen(false); setToDelete(null); setForm(EMPTY_FORM); setDup(null); }
      else if ((fetcher.data as any).duplicate) setDup((fetcher.data as any).duplicate);
      else app.toast.show((fetcher.data as any).error || tr("common.error"), { isError: true });
    }
  }, [fetcher.state, fetcher.data, app, tr]);

  const submit = () => fetcher.submit({ intent: "create", ...form, force: dup ? "1" : "" }, { method: "post" });
  const set = (k: keyof typeof form) => (v: string) => { setDup(null); setForm((f) => ({ ...f, [k]: v })); };
  const runSearch = () => setParams(search.trim() ? { q: search.trim() } : {});

  const rows = useMemo(() => (entries as any[])
    .filter((e) => (!reasonFilter || e.reason === reasonFilter) && (!netFilter || (netFilter === "shared" ? e.shared : !e.shared)))
    .map((e) => {
      const of = (k: string) => e.identifiers.filter((x: any) => x.kind === k).map((x: any) => x.raw as string);
      const emails = of("email"), phones = of("phone"), names = of("name"), addresses = of("address"), devices = of("device");
      const title = names[0] || emails[0] || phones[0] || addresses[0] || tr("common.customer");
      const a = (activity as Record<string, { tries: number; last: number; checks: number }>)[e.id];
      return { ...e, emails, phones, names, addresses, devices, title, tries: a?.tries ?? 0, checks: a?.checks ?? 0, last: a?.last || 0 };
    }), [entries, reasonFilter, netFilter, tr, activity]);
  const cards = useMemo(() => [...rows].sort((x: any, y: any) => (y.last - x.last) || (+new Date(y.createdAt) - +new Date(x.createdAt))), [rows]);
  const ago = (t: number) => {
    if (!t) return "—";
    const d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return tr("bl.todayAt", { time: d.toLocaleTimeString(dateLocale(lang), { hour: "2-digit", minute: "2-digit" }) });
    return d.toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" });
  };

  const filtered = !!(reasonFilter || netFilter);

  return (
    <Page fullWidth>
      <TitleBar title={tr("nav.blacklist")}>
        <button variant="primary" onClick={() => setOpen(true)}>{tr("index.addCustomer")}</button>
      </TitleBar>
      {outlet ? (
        <div className="sf-split">
          <aside className="sf-split-list" aria-label={tr("nav.blacklist")}>
            <div className="sf-split-head">
              <InlineStack align="space-between" blockAlign="baseline">
                <Text as="h2" variant="headingLg">{tr("nav.blacklist")}</Text>
                <Text as="span" tone="subdued">{total}</Text>
              </InlineStack>
              <form onSubmit={(ev) => { ev.preventDefault(); runSearch(); }} role="search">
                <TextField label={tr("common.search")} labelHidden placeholder={tr("index.searchPlaceholder")} value={search} onChange={setSearch} autoComplete="off"
                  prefix={<Icon source={SearchIcon} tone="subdued" />} clearButton onClearButtonClick={() => { setSearch(""); setParams({}); }} />
              </form>
            </div>
            <ul>
              {cards.map((e: any) => (
                <li key={e.id}>
                  <Link to={`/app/blacklist/${e.id}${q ? `?q=${encodeURIComponent(q)}` : ""}`} className={`sf-split-item${e.id === openId ? " on" : ""}`} aria-current={e.id === openId ? "page" : undefined}>
                    <span className={`sf-split-dot ${REASON_BAND[e.reason] ?? "gray"}`} aria-hidden="true" />
                    <span className="sf-split-who">
                      <span className="sf-split-name">{e.title}</span>
                      <span className="sf-split-sub">{reasonLabel(e.reason)}</span>
                    </span>
                    <span className="sf-split-when">{e.last ? ago(e.last) : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
          <section className="sf-split-main">{outlet}</section>
        </div>
      ) : (
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {!network && <Banner tone="warning" action={{ content: tr("nav.settings"), url: "/app/settings" }}>{tr("index.networkOffBanner")}</Banner>}

            {/* hero: count, search, reason chips */}
            <div className="sf-bl-hero">
              <div className="sf-bl-hero-top">
                <div className="sf-bl-hero-title">
                  <span className="sf-lamp-v sf-bl-lamp"><Lamp size="lg" level="red" label={tr("nav.blacklist")} /></span>
                  <div>
                    <p className="sf-bl-eyebrow">Semafor · {tr("nav.blacklist")}</p>
                    <h1 className="sf-bl-count">{tr("bl.count", { n: total })}</h1>
                    <p className="sf-bl-sub">{tr("bl.sub", { a: added7, t: triedToday, s: shared })}</p>
                  </div>
                </div>
                <div className="sf-bl-actions">
                  <Link to="/app/import" className="sf-bl-btn ghost">{tr("nav.import")}</Link>
                  <button type="button" className="sf-bl-btn" onClick={() => setOpen(true)}>+ {tr("index.addCustomer")}</button>
                </div>
              </div>
              <form className="sf-bl-search" onSubmit={(ev) => { ev.preventDefault(); runSearch(); }} role="search">
                <Icon source={SearchIcon} tone="subdued" />
                <label className="sf-visually-hidden" htmlFor="sf-bl-q">{tr("common.search")}</label>
                <input id="sf-bl-q" value={search} onChange={(ev) => setSearch(ev.target.value)} placeholder={tr("index.searchPlaceholder")} autoComplete="off" />
                {(search || q) && <button type="button" className="sf-bl-clear" onClick={() => { setSearch(""); setParams({}); }}>{tr("dash.clearFilters")}</button>}
              </form>
              <div className="sf-bl-chips">
                <button type="button" className={`sf-bl-chip${!reasonFilter && !netFilter ? " on" : ""}`} onClick={() => { setReasonFilter(""); setNetFilter(""); }}>{tr("bl.all")} · {total}</button>
                {REASONS.filter((r) => (reasonCounts as any)[r]).map((r) => (
                  <button type="button" key={r} className={`sf-bl-chip${reasonFilter === r ? " on" : ""}`} onClick={() => setReasonFilter(reasonFilter === r ? "" : r)}>{reasonLabel(r)} · {(reasonCounts as any)[r]}</button>
                ))}
                <button type="button" className={`sf-bl-chip${netFilter === "shared" ? " on" : ""}`} onClick={() => setNetFilter(netFilter === "shared" ? "" : "shared")}>{tr("dash.netShared")} · {shared}</button>
              </div>
            </div>

            <InlineStack align="space-between" blockAlign="center" gap="200">
              <Text as="p" tone="subdued">{filtered || q ? tr("dash.showing", { n: rows.length, total }) : tr("bl.sorted")}</Text>
              <ButtonGroup variant="segmented">
                <Button pressed={view === "cards"} onClick={() => pickView("cards")}>{tr("bl.viewCards")}</Button>
                <Button pressed={view === "table"} onClick={() => pickView("table")}>{tr("bl.viewTable")}</Button>
              </ButtonGroup>
            </InlineStack>

            {view === "cards" && total > 0 && rows.length > 0 ? (
              <div className="sf-bl-grid">
                {cards.map((e: any) => (
                  <Link key={e.id} to={`/app/blacklist/${e.id}`} className="sf-bl-card">
                    <span className={`sf-bl-band ${REASON_BAND[e.reason] ?? "gray"}`} aria-hidden="true" />
                    <div className="sf-bl-card-body">
                      <div className="sf-bl-card-head">
                        <span className="sf-bl-ini" aria-hidden="true">{initials(e.title)}</span>
                        <div className="sf-bl-who">
                          <span className="sf-bl-name">{e.title}</span>
                          <span className="sf-bl-since">{tr("bl.since", { date: new Date(e.createdAt).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" }), source: e.orderName ? `${sourceLabel(e.source)} ${e.orderName}` : sourceLabel(e.source) })}</span>
                        </div>
                        <Badge tone={REASON_TONE[e.reason]}>{reasonLabel(e.reason)}</Badge>
                      </div>
                      <div className="sf-bl-ids">
                        {e.emails.slice(0, 2).map((x: string) => <IdLine key={x} icon={EmailIcon} label={tr("kind.email")}>{x}</IdLine>)}
                        {e.phones.slice(0, 2).map((x: string) => <IdLine key={x} icon={PhoneIcon} label={tr("kind.phone")}>{x}</IdLine>)}
                        {e.addresses.slice(0, 1).map((x: string) => <IdLine key={x} icon={LocationIcon} label={tr("kind.address")}>{x}</IdLine>)}
                      </div>
                      <div className="sf-bl-tags">
                        {e.tries > 0 && e.last >= new Date().setHours(0, 0, 0, 0) && <span className="hot">{tr("bl.triedToday")}</span>}
                        {e.devices.length > 0 && <span>{tr("dash.devices", { n: e.devices.length })}</span>}
                        {e.emails.length + e.phones.length > 2 && <span>{tr("bl.moreData", { n: e.emails.length + e.phones.length })}</span>}
                        {e.shared && <span>{tr("index.reported")}</span>}
                      </div>
                    </div>
                    <div className="sf-bl-foot">
                      <div><span>{tr("bl.fChecks")}</span><b>{e.checks}</b></div>
                      <div><span>{tr("bl.fTries")}</span><b className={e.tries ? "red" : ""}>{e.tries}</b></div>
                      <div><span>{tr("bl.fLast")}</span><b className="sm">{ago(e.last)}</b></div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
            <Card padding="0">
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
                              <Link to={`/app/blacklist/${e.id}`} className="sf-cust-link"><Text as="span" fontWeight="semibold"><span className="sf-break">{e.title}</span></Text></Link>
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
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
      )}

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title={tr("dash.deleteTitle")}
        primaryAction={{ content: tr("common.delete"), destructive: true, loading: !!deletingId, onAction: () => toDelete && fetcher.submit({ intent: "delete", id: toDelete.id }, { method: "post" }) }}
        secondaryActions={[{ content: tr("common.cancel"), onAction: () => setToDelete(null) }]}>
        <Modal.Section>
          <Text as="p">{tr("dash.deleteText", { name: toDelete?.name || "" })}</Text>
        </Modal.Section>
      </Modal>

      <Modal open={open} onClose={() => { setOpen(false); setDup(null); }} title={tr("index.modalTitle")}
        primaryAction={{ content: dup ? tr("index.dupAddAnyway") : tr("common.save"), onAction: submit, loading: busy }}
        secondaryActions={[{ content: tr("common.cancel"), onAction: () => { setOpen(false); setDup(null); } }]}>
        <Modal.Section>
          {dup && (
            <Box paddingBlockEnd="400">
              <Banner tone="warning" title={tr("index.dupTitle", { n: String(dup.length) })}>
                <BlockStack gap="100">
                  {dup.map((e: any, k: number) => (
                    <Text as="p" key={k}>
                      {[new Date(e.createdAt).toLocaleDateString(dateLocale(lang)), e.orderName, reasonLabel(e.reason)].filter(Boolean).join(" · ")}
                      {e.matched?.length ? ` — ${tr("index.dupMatches", { kinds: [...new Set(e.matched.map((m: any) => tr(`kind.${m.kind}` as TKey)))].join(", ") })}` : ""}
                    </Text>
                  ))}
                  <Text as="p" tone="subdued">{tr("index.dupHint")}</Text>
                </BlockStack>
              </Banner>
            </Box>
          )}
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
