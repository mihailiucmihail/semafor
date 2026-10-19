// Owner-only marketing funnel: ad spend (Meta) → real visitors → "Install" clicks → installs, per reel.
// Sources:
//   • Meta Ads Insights API (optional, env META_ADS_TOKEN with ads_read; META_AD_ACCOUNT, default act_1312588463752308)
//   • our own site counters (AppKv "clk:<day>:<event>:<campaign>:<content>", written by /api/click; humans only)
//   • installs / uninstalls from our Shop table (real merchant stores; owner and test stores excluded)
import db from "../db.server";
import { isOwnerShop } from "./plan.server";

const DAY = 86_400_000;
const TEST_SHOPS = (process.env.SEMAFOR_PRO_SHOPS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const isTest = (d: string) => isOwnerShop(d) || TEST_SHOPS.includes(d.toLowerCase()) || /test|dev|demo|review/i.test(d);

export type FunnelRow = {
  key: string; label: string;
  spend: number | null; impressions: number | null; reach: number | null; linkClicks: number | null; lpv: number | null;
  views: number; visitors: number; installClicks: number;
};

/** "reel6_easybox" / "Semafor · RO · Reel 6 easybox" → "reel6"; everything else → its own key. */
const reelKey = (s: string) => { const m = /reel\s*(\d+)/i.exec(s); return m ? `reel${m[1]}` : s; };

async function metaInsights(since: string, until: string) {
  const token = process.env.META_ADS_TOKEN;
  if (!token) return { ok: false as const, reason: "no_token", rows: [] as any[] };
  const acct = process.env.META_AD_ACCOUNT || "act_1312588463752308";
  const v = process.env.META_API_VERSION || "v23.0";
  const qs = new URLSearchParams({
    level: "campaign",
    fields: "campaign_name,spend,impressions,reach,inline_link_clicks,actions",
    time_range: JSON.stringify({ since, until }),
    filtering: JSON.stringify([{ field: "campaign.name", operator: "CONTAIN", value: "Semafor" }]),
    limit: "200",
    access_token: token,
  });
  try {
    const r = await fetch(`https://graph.facebook.com/${v}/${acct}/insights?${qs}`);
    const j: any = await r.json();
    if (j.error) return { ok: false as const, reason: String(j.error.message || "error").slice(0, 160), rows: [] };
    return { ok: true as const, reason: "", rows: (j.data || []) as any[] };
  } catch (e: any) {
    return { ok: false as const, reason: String(e?.message || e).slice(0, 160), rows: [] };
  }
}

export async function funnel(days: number) {
  const now = Date.now();
  const sinceDay = new Date(now - (days - 1) * DAY).toISOString().slice(0, 10);
  const untilDay = new Date(now).toISOString().slice(0, 10);

  const rows = new Map<string, FunnelRow>();
  const row = (key: string, label: string) => {
    let r = rows.get(key);
    if (!r) { r = { key, label, spend: null, impressions: null, reach: null, linkClicks: null, lpv: null, views: 0, visitors: 0, installClicks: 0 }; rows.set(key, r); }
    return r;
  };

  // 1) Meta Ads
  const meta = await metaInsights(sinceDay, untilDay);
  for (const c of meta.rows) {
    const name = String(c.campaign_name || "");
    const r = row(reelKey(name), name);
    const lpv = (c.actions || []).find((a: any) => a.action_type === "landing_page_view");
    r.spend = (r.spend || 0) + Number(c.spend || 0);
    r.impressions = (r.impressions || 0) + Number(c.impressions || 0);
    r.reach = (r.reach || 0) + Number(c.reach || 0);
    r.linkClicks = (r.linkClicks || 0) + Number(c.inline_link_clicks || 0);
    r.lpv = (r.lpv || 0) + Number(lpv?.value || 0);
  }

  // 2) our site counters (humans only)
  const kv = await db.appKv.findMany({ where: { key: { startsWith: "clk:" } }, select: { key: true, value: true } });
  for (const { key, value } of kv) {
    const [, day, event, campaign, content] = key.split(":");
    if (day < sinceDay || day > untilDay) continue;
    const n = Number(value) || 0;
    const paid = content && content !== "-";
    const k = paid ? reelKey(content) : campaign && campaign !== "-" && !/^(ro|en|es|fr|pl|ru)$/.test(campaign) ? campaign : "organic";
    const r = row(k, paid ? content : k === "organic" ? "Organic / direct" : campaign);
    if (event === "view") r.views += n;
    else if (event === "landing") r.visitors += n;
    else if (event === "install_click") r.installClicks += n;
  }

  // 3) installs (real stores only)
  const since = new Date(now - days * DAY);
  const shops = await db.shop.findMany({
    where: { OR: [{ installedAt: { gte: since } }, { uninstalledAt: { gte: since } }] },
    select: { domain: true, installedAt: true, uninstalledAt: true, plan: true },
  });
  const real = shops.filter((s) => !isTest(s.domain));
  const installs = real.filter((s) => s.installedAt >= since).length;
  const uninstalls = real.filter((s) => s.uninstalledAt && s.uninstalledAt >= since).length;
  const active = (await db.shop.findMany({ where: { uninstalledAt: null }, select: { domain: true, plan: true } })).filter((s) => !isTest(s.domain));
  const activeNow = active.length;
  const paying = active.filter((s) => s.plan === "basic" || s.plan === "pro").length;

  const list = [...rows.values()].sort((a, b) => (b.spend || 0) - (a.spend || 0) || b.visitors - a.visitors);
  const sum = (f: (r: FunnelRow) => number | null) => list.reduce((s, r) => s + (f(r) || 0), 0);
  const totals = {
    spend: sum((r) => r.spend), impressions: sum((r) => r.impressions), linkClicks: sum((r) => r.linkClicks), lpv: sum((r) => r.lpv),
    views: sum((r) => r.views), visitors: sum((r) => r.visitors), installClicks: sum((r) => r.installClicks),
    installs, uninstalls, paying, activeNow,
  };
  return { days, sinceDay, untilDay, meta: { ok: meta.ok, reason: meta.reason }, rows: list, totals, at: new Date().toISOString() };
}
