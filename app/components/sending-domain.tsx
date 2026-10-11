// Emails page card: "Send from your own domain" (connect → DNS records → verify → use your address).
import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Badge, Banner, BlockStack, Box, Button, Card, Collapsible, InlineStack, Link, Modal, Text, TextField } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { SectionHead } from "./semafor-ui";
import { useT, useLang, dateLocale, type TKey } from "../i18n";
import { DOMAIN_GUIDE } from "../semafor/domain-guide";
import type { SendingDomain } from "../../core/settings";

const STATUS_TONE: Record<string, "success" | "attention" | "critical" | undefined> = { verified: "success", pending: "attention", failed: "critical", temporary_failure: "critical" };
const statusKey = (s: string) => (s === "verified" || s === "pending" || s === "failed" ? s : s === "temporary_failure" ? "failed" : "not_started");

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
  } catch { return false; }
}

function CopyCell({ value, sub }: { value: string; sub?: string }) {
  const tr = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="sf-dns-val">
      <div className="sf-dns-text">
        <code title={value}>{value}</code>
        {sub && <span className="sf-dns-sub">{sub}</span>}
      </div>
      <Button size="micro" onClick={async () => { if (await copyText(value)) { setDone(true); setTimeout(() => setDone(false), 1600); } }}>{done ? tr("dom.copied") : tr("dom.copy")}</Button>
    </div>
  );
}

export function SendingDomainCard({ domain, suggest, fromEmail, onSuggestFrom, helpUrl }: {
  domain: SendingDomain | null | undefined; suggest: string; fromEmail: string; onSuggestFrom: (email: string) => void; helpUrl: string;
}) {
  const tr = useT();
  const lang = useLang();
  const app = useAppBridge();
  const f = useFetcher<any>();
  const [input, setInput] = useState(suggest);
  const [guide, setGuide] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const d: SendingDomain | null = (f.data && "domain" in f.data ? f.data.domain : domain) ?? null;
  const busy = (k: string) => f.state !== "idle" && f.formData?.get("intent") === k;
  const err = f.data?.domainError as string | undefined;
  const verified = d?.status === "verified";
  useEffect(() => {
    if (f.state !== "idle" || !f.data?.domainMsg) return;
    app.toast.show(tr(f.data.domainMsg as TKey, { name: d?.name ?? "" }));
  }, [f.state, f.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // verified and no own address yet → suggest info@<domain> (never overwrites what the merchant typed)
  useEffect(() => { if (verified && d && !fromEmail) onSuggestFrom(`info@${d.name}`); }, [verified, d?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = DOMAIN_GUIDE[lang === "ro" ? "ro" : "en"];
  const sk = d ? statusKey(d.status) : "not_started";

  return (
    <Card>
      <BlockStack gap="400">
        <SectionHead title={tr("dom.title")} description={tr("dom.desc")}>
          {d && <Badge tone={STATUS_TONE[d.status]}>{tr(`dom.status.${sk}` as TKey)}</Badge>}
        </SectionHead>

        {!d ? (
          <InlineStack gap="200" blockAlign="end" wrap>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <TextField label={tr("dom.label")} value={input} onChange={setInput} autoComplete="off" placeholder={suggest || "magazinul-tau.ro"} helpText={tr("dom.labelHelp")} />
            </div>
            <Button variant="primary" loading={busy("domainConnect")} disabled={!input.trim()} onClick={() => f.submit({ intent: "domainConnect", domain: input }, { method: "post" })}>{tr("dom.connect")}</Button>
          </InlineStack>
        ) : (
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center" wrap>
              <Text as="span" variant="headingSm"><span className="sf-break">{d.name}</span></Text>
              <Text as="span" variant="bodySm" tone="subdued">{tr("dom.checked", { date: new Date(d.checkedAt).toLocaleString(dateLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}</Text>
            </InlineStack>
            {verified
              ? <Banner tone="success">{tr("dom.verifiedBanner", { from: fromEmail && fromEmail.endsWith("@" + d.name) ? fromEmail : `info@${d.name}` })}</Banner>
              : <Banner tone={sk === "failed" ? "warning" : "info"}>{tr(sk === "failed" ? "dom.failedHint" : "dom.addHint")}</Banner>}
            {!verified && d.records.length > 0 && (
              <div className="sf-dns" role="table" aria-label={tr("dom.records")}>
                <div className="sf-dns-row sf-dns-head" role="row">
                  <span role="columnheader">{tr("dom.colType")}</span><span role="columnheader">{tr("dom.colName")}</span><span role="columnheader">{tr("dom.colValue")}</span><span role="columnheader">{tr("dom.colPriority")}</span><span role="columnheader">TTL</span>
                </div>
                {d.records.map((r, i) => (
                  <div className="sf-dns-row" role="row" key={i}>
                    <span role="cell"><Badge tone={r.status === "verified" ? "success" : undefined}>{r.type}</Badge></span>
                    <span role="cell"><CopyCell value={r.name} sub={r.name && !r.name.endsWith(d.name) ? `${r.name}.${d.name}` : undefined} /></span>
                    <span role="cell"><CopyCell value={r.value} /></span>
                    <span role="cell" className="sf-num">{r.priority ?? "—"}</span>
                    <span role="cell">{tr("dom.auto")}</span>
                  </div>
                ))}
              </div>
            )}
            {!verified && <Text as="p" variant="bodySm" tone="subdued">{tr("dom.nameNote")}</Text>}
            {err && <Banner tone="critical">{tr(`dom.err.${err}` as TKey)}{f.data?.detail && err !== "limit" ? ` (${f.data.detail})` : ""}</Banner>}
            <InlineStack gap="200" wrap>
              {!verified && <Button variant="primary" loading={busy("domainVerify")} onClick={() => f.submit({ intent: "domainVerify" }, { method: "post" })}>{tr("dom.verify")}</Button>}
              <Button tone="critical" variant="plain" onClick={() => setConfirm(true)}>{tr("dom.disconnect")}</Button>
            </InlineStack>
            {!verified && <Text as="p" variant="bodySm" tone="subdued">{tr("dom.dnsTime")}</Text>}
          </BlockStack>
        )}
        {!d && err && <Banner tone="critical">{tr(`dom.err.${err}` as TKey)}{f.data?.detail && err !== "limit" ? ` (${f.data.detail})` : ""}</Banner>}

        <Box>
          <InlineStack gap="300" blockAlign="center" wrap>
            <Button variant="plain" disclosure={guide ? "up" : "down"} onClick={() => setGuide((v) => !v)}>{g.title}</Button>
            <Link url={helpUrl} target="_blank">{tr("dom.helpLink")}</Link>
          </InlineStack>
        </Box>
        <Collapsible id="sf-dom-guide" open={guide}>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm">{g.intro}</Text>
            {g.providers.map((p) => (
              <BlockStack key={p.name} gap="100">
                <Text as="h3" variant="headingSm">{p.name}</Text>
                <ol className="sf-guide-steps">{p.steps.map((s, i) => <li key={i}><Text as="span" variant="bodySm">{s}</Text></li>)}</ol>
              </BlockStack>
            ))}
            <Text as="h3" variant="headingSm">{g.faqTitle}</Text>
            {g.faq.map((q) => (
              <BlockStack key={q.q} gap="050">
                <Text as="p" variant="bodySm" fontWeight="semibold">{q.q}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{q.a}</Text>
              </BlockStack>
            ))}
          </BlockStack>
        </Collapsible>
      </BlockStack>

      <Modal open={confirm} onClose={() => setConfirm(false)} title={tr("dom.disconnectTitle", { name: d?.name ?? "" })}
        primaryAction={{ content: tr("dom.disconnect"), destructive: true, loading: busy("domainRemove"), onAction: () => { f.submit({ intent: "domainRemove" }, { method: "post" }); setConfirm(false); } }}
        secondaryActions={[{ content: tr("common.cancel"), onAction: () => setConfirm(false) }]}>
        <Modal.Section><Text as="p">{tr("dom.disconnectBody")}</Text></Modal.Section>
      </Modal>
    </Card>
  );
}
