// "Brought by Semafor" pieces shared by the checks, client, stats, pop-up and e-mails pages.
import { useNavigate } from "@remix-run/react";
import { Badge, BlockStack, Text } from "@shopify/polaris";
import { ReceiptIcon } from "@shopify/polaris-icons";
import { Kpi } from "./semafor-ui";
import { useT, useLang, dateLocale, type TKey } from "../i18n";
import type { Attribution, AttrSource } from "../../core/attribution";

/** "2 days later" / "3 h later" / "25 min later" */
export function useDelayText() {
  const tr = useT();
  return (min: number | null | undefined) => {
    if (min == null) return "";
    if (min < 60) return tr("attr.delayMin", { n: Math.max(1, min) });
    if (min < 48 * 60) return tr("attr.delayH", { n: Math.round(min / 60) });
    return tr("attr.delayD", { n: Math.round(min / 1440) });
  };
}

/** Badge "Brought by Semafor: Pop-up in cart" + touch time, delay and the Semafor code used. */
export function AttrBadge({ a, compact }: { a: Attribution | null | undefined; compact?: boolean }) {
  const tr = useT();
  const lang = useLang();
  const delay = useDelayText();
  if (!a?.primary) return null;
  const when = a.at ? new Date(a.at).toLocaleString(dateLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <BlockStack gap="050" inlineAlign="start">
      <Badge tone="magic">{tr("attr.badge", { src: tr(`attr.src.${a.primary}` as TKey) })}</Badge>
      {!compact && <Text as="span" variant="bodySm" tone="subdued">{[when, delay(a.delayMin), a.usedCode ? tr("attr.code", { code: a.usedCode }) : ""].filter(Boolean).join(" · ")}</Text>}
    </BlockStack>
  );
}

export type AttrSummaryData = { count: number; revenue: number; currency: string | null; bySource: Record<AttrSource, { count: number; revenue: number }> };

/** KPI card "Orders brought by Semafor" (last 30 days); opens the list. */
export function AttrKpi({ s, sources, src }: { s: AttrSummaryData; sources?: AttrSource[]; src?: string }) {
  const tr = useT();
  const lang = useLang();
  const navigate = useNavigate();
  let money = "";
  try { money = new Intl.NumberFormat(dateLocale(lang), { style: "currency", currency: s.currency || "EUR", maximumFractionDigits: 0 }).format(s.revenue); } catch { money = `${Math.round(s.revenue)} ${s.currency || ""}`; }
  const parts = (sources ?? (["popup_site", "popup_cart", "email"] as AttrSource[])).map((k) => `${tr(`attr.src.${k}` as TKey)} ${s.bySource[k].count}`).join(" · ");
  return (
    <Kpi icon={ReceiptIcon} label={tr("attr.kpi")} value={s.count} tone={s.count ? "success" : undefined}
      hint={<>{tr("attr.kpiHint", { revenue: money })}<br />{parts}</>}
      onClick={() => navigate(`/app/attributed${src ? `?src=${src}` : ""}`)} />
  );
}
