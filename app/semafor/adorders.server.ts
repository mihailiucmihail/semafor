/**
 * Owner page «Реклама»: which ad (reel) brought which order.
 *  - orders of the period with Shopify's customerJourneySummary (first / last visit + UTM) → core/adattr.ts decides the source;
 *  - optional Meta Ads Insights (env META_ADS_TOKEN with ads_read; account META_STORE_AD_ACCOUNT, default the store's
 *    "Mihailiuc Group Ads" act_1514522812566848): names for the ID links and the spend per ad, also for ads with no order.
 * Read-only: no scopes, webhooks or extensions involved (read_orders is already granted).
 */
import { orderSource, groupByAd, isMetaId, type AdOrder, type AdRow, type Channel } from "../../core/adattr";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };
const DAY = 86_400_000;

const VISIT = `source sourceType landingPage utmParameters{ source medium campaign content term }`;
const Q = `query($q:String!,$after:String){ orders(first:100, after:$after, sortKey:CREATED_AT, reverse:true, query:$q){
  pageInfo{ hasNextPage endCursor }
  nodes{ id name createdAt cancelledAt totalPriceSet{ presentmentMoney{ amount currencyCode } }
    customerJourneySummary{ firstVisit{ ${VISIT} } lastVisit{ ${VISIT} } } } } }`;

export async function fetchOrders(admin: Admin, days: number, max = 1000): Promise<AdOrder[]> {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const out: AdOrder[] = [];
  let after: string | null = null;
  while (out.length < max) {
    const r: any = await (await admin.graphql(Q, { variables: { q: `created_at:>='${since}' status:any`, after } })).json();
    if (r.errors) throw new Error(JSON.stringify(r.errors).slice(0, 300));
    const c = r?.data?.orders;
    for (const o of (c?.nodes ?? []) as any[]) {
      out.push({
        id: o.id, name: o.name, at: o.createdAt, cancelled: !!o.cancelledAt,
        total: Number(o.totalPriceSet?.presentmentMoney?.amount ?? 0), currency: o.totalPriceSet?.presentmentMoney?.currencyCode || "RON",
        src: orderSource(o.customerJourneySummary),
      });
    }
    if (!c?.pageInfo?.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  return out;
}

export type MetaAd = { campaignId: string; campaign: string; adsetId: string; adset: string; adId: string; ad: string; spend: number; clicks: number; lpv: number };

async function metaAds(days: number): Promise<{ ok: boolean; reason: string; currency: string | null; ads: MetaAd[] }> {
  const token = process.env.META_ADS_TOKEN;
  if (!token) return { ok: false, reason: "нет токена Meta (META_ADS_TOKEN)", currency: null, ads: [] };
  const acct = process.env.META_STORE_AD_ACCOUNT || "act_1514522812566848";
  const v = process.env.META_API_VERSION || "v23.0";
  const since = new Date(Date.now() - (days - 1) * DAY).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);
  const qs = new URLSearchParams({
    level: "ad",
    fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,inline_link_clicks,actions,account_currency",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
    access_token: token,
  });
  try {
    const ads: MetaAd[] = [];
    let url: string | null = `https://graph.facebook.com/${v}/${acct}/insights?${qs}`;
    let currency: string | null = null;
    for (let i = 0; url && i < 10; i++) {
      const j: any = await (await fetch(url, { signal: AbortSignal.timeout(20_000) })).json();
      if (j.error) return { ok: false, reason: String(j.error.message || "ошибка Meta").slice(0, 200), currency: null, ads: [] };
      for (const a of (j.data ?? []) as any[]) {
        currency = currency || a.account_currency || null;
        const lpv = (a.actions || []).find((x: any) => x.action_type === "landing_page_view");
        ads.push({
          campaignId: String(a.campaign_id), campaign: String(a.campaign_name || ""), adsetId: String(a.adset_id), adset: String(a.adset_name || ""),
          adId: String(a.ad_id), ad: String(a.ad_name || ""), spend: Number(a.spend || 0), clicks: Number(a.inline_link_clicks || 0), lpv: Number(lpv?.value || 0),
        });
      }
      url = j.paging?.next || null;
    }
    return { ok: true, reason: "", currency, ads };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 200), currency: null, ads: [] };
  }
}

export type ReklamaRow = AdRow & { spend: number | null; clicks: number | null; lpv: number | null };

export async function reklama(admin: Admin, days: number) {
  const [orders, meta] = await Promise.all([fetchOrders(admin, days), metaAds(days)]);
  const names = { campaigns: {} as Record<string, string>, adsets: {} as Record<string, string>, ads: {} as Record<string, string> };
  for (const a of meta.ads) { names.campaigns[a.campaignId] = a.campaign; names.adsets[a.adsetId] = a.adset; names.ads[a.adId] = a.ad; }
  const grouped = groupByAd(orders, names);

  // spend per (campaign name, ad name); an ad row of an old hand-made link has no ad → the campaign's total
  const rows: ReklamaRow[] = grouped.map((r) => ({ ...r, spend: null, clicks: null, lpv: null }));
  if (meta.ok) {
    const used = new Set<string>();
    for (const r of rows) {
      const hit = meta.ads.filter((a) => a.campaign === r.campaign && (r.ad === "—" || a.ad === r.ad));
      if (!hit.length) continue;
      r.spend = hit.reduce((s, a) => s + a.spend, 0); r.clicks = hit.reduce((s, a) => s + a.clicks, 0); r.lpv = hit.reduce((s, a) => s + a.lpv, 0);
      for (const a of hit) used.add(a.adId);
    }
    // ads that spent money and brought no order (tracked so far)
    const rest = new Map<string, ReklamaRow>();
    for (const a of meta.ads) {
      if (used.has(a.adId) || a.spend <= 0) continue;
      const key = `${a.campaign}|${a.ad}`;
      const r = rest.get(key) ?? { key, campaign: a.campaign, ad: a.ad, adset: a.adset, orders: [], revenue: {}, lastAt: null, spend: 0, clicks: 0, lpv: 0 };
      r.spend! += a.spend; r.clicks! += a.clicks; r.lpv! += a.lpv;
      rest.set(key, r);
    }
    rows.push(...[...rest.values()].sort((x, y) => (y.spend || 0) - (x.spend || 0)));
  }

  const channels = new Map<Channel, { count: number; revenue: Record<string, number> }>();
  for (const o of orders) {
    if (o.cancelled) continue;
    const c = channels.get(o.src.channel) ?? { count: 0, revenue: {} };
    c.count++; c.revenue[o.currency] = Math.round(((c.revenue[o.currency] ?? 0) + o.total) * 100) / 100;
    channels.set(o.src.channel, c);
  }
  // readable names for the ID links in the orders list too
  const pretty = (s: string | null, map: Record<string, string>) => (s && isMetaId(s) ? map[s] ?? s : s);
  const list = orders.map((o) => ({
    ...o,
    src: { ...o.src, campaign: pretty(o.src.campaign, names.campaigns), adset: pretty(o.src.adset, names.adsets), ad: pretty(o.src.ad, names.ads) },
  }));
  return {
    days, at: new Date().toISOString(),
    meta: { ok: meta.ok, reason: meta.reason, currency: meta.currency },
    rows, orders: list,
    channels: [...channels.entries()].map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.count - a.count),
    totals: { orders: orders.filter((o) => !o.cancelled).length, ads: orders.filter((o) => !o.cancelled && o.src.channel === "meta_ads").length, unknown: orders.filter((o) => !o.cancelled && o.src.channel === "unknown").length },
  };
}
