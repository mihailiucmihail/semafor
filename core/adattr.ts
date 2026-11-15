// Where did an order come from? (owner page «Реклама»)
// Input: Shopify's customerJourneySummary of the order (first and last visit, with UTM parameters).
// Pure — no I/O; the Shopify / Meta calls live in app/semafor/adorders.server.ts.

export type Channel = 'meta_ads' | 'email' | 'instagram' | 'facebook' | 'google' | 'tiktok' | 'direct' | 'other' | 'unknown';

export const CHANNEL_LABEL: Record<Channel, string> = {
  meta_ads: 'Реклама Meta',
  email: 'E-mail рассылка',
  instagram: 'Instagram (без рекламы)',
  facebook: 'Facebook (без рекламы)',
  google: 'Google',
  tiktok: 'TikTok',
  direct: 'Прямой заход',
  other: 'Другие сайты',
  unknown: 'Нет данных',
};

export type Utm = { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; term?: string | null } | null | undefined;
export type Visit = { source?: string | null; sourceType?: string | null; landingPage?: string | null; utmParameters?: Utm } | null | undefined;

export type VisitInfo = {
  channel: Channel;
  /** ads only: campaign / ad set / ad as found in the link (names with our new links, IDs with the auto links, a single word with the old hand-made links) */
  campaign: string | null;
  adset: string | null;
  ad: string | null;
};

const low = (s: unknown) => String(s ?? '').trim().toLowerCase();
const META_SOURCES = ['facebook', 'fb', 'ig', 'instagram', 'meta', 'an', 'msg', 'threads'];

/** One visit → channel (+ campaign / ad for Meta ads). */
export function classifyVisit(v: Visit): VisitInfo {
  const none = { campaign: null, adset: null, ad: null };
  if (!v) return { channel: 'unknown', ...none };
  const u = v.utmParameters || null;
  const src = low(u?.source), med = low(u?.medium), camp = String(u?.campaign ?? '').trim();
  const content = String(u?.content ?? '').trim(), term = String(u?.term ?? '').trim();
  if (u && (src || med || camp)) {
    if (src === 'shopify_email' || med === 'email' || src === 'email' || src === 'newsletter') return { channel: 'email', ...none };
    // our ad links: utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}…  (also Meta's own {{…id}} links)
    if (META_SOURCES.includes(src) && ['paid', 'cpc', 'ppc', 'ads', 'paid_social', 'paidsocial', 'cpm'].includes(med)) {
      return { channel: 'meta_ads', campaign: camp || null, adset: term || null, ad: content || null };
    }
    if ((src === 'ig' || src === 'instagram') && (med === 'social' || content === 'link_in_bio' || !med)) return { channel: 'instagram', ...none };
    if ((src === 'facebook' || src === 'fb') && (med === 'social' || !med)) return { channel: 'facebook', ...none };
    if (src.includes('google')) return { channel: 'google', ...none };
    if (src.includes('tiktok')) return { channel: 'tiktok', ...none };
    // old hand-made ad links: the same word in source / medium / campaign / content ("germania-mia-maro", "miaciocolataromania")
    const words = [src, med, low(camp), low(content)].filter(Boolean);
    if (words.length >= 2 && new Set(words).size === 1) return { channel: 'meta_ads', campaign: u.campaign ? String(u.campaign) : String(u.source), adset: null, ad: content || null };
  }
  const s = low(v.source), st = low(v.sourceType);
  if (st === 'newsletter' || s === 'email') return { channel: 'email', ...none };
  if (s.includes('instagram')) return { channel: 'instagram', ...none };
  if (s.includes('facebook')) return { channel: 'facebook', ...none };
  if (s.includes('google') || st === 'seo' || st === 'sem') return { channel: 'google', ...none };
  if (s.includes('tiktok')) return { channel: 'tiktok', ...none };
  if (s === 'direct' || !s) return { channel: 'direct', ...none };
  // a visit "from" our own pages (checkout, another of our domains) says nothing about the source
  if (/mihailiuc\.|myshopify\.com/.test(s)) return { channel: 'direct', ...none };
  return { channel: 'other', ...none };
}

export type OrderSource = VisitInfo & {
  /** which visit carried the ad / the channel: 'last' (last click before the order) or 'first' (the first visit) */
  touch: 'last' | 'first' | null;
  /** channel of the other visit, when different (e.g. ad first, then came back from an e-mail) */
  also: Channel | null;
};

/**
 * Order source. An ad wins whenever one of the two visits came from an ad (last visit preferred);
 * otherwise the last visit's channel ("direct" last visit falls back to the first visit's channel).
 */
export function orderSource(j: { firstVisit?: Visit; lastVisit?: Visit } | null | undefined): OrderSource {
  const first = classifyVisit(j?.firstVisit), last = classifyVisit(j?.lastVisit);
  const hasFirst = !!j?.firstVisit, hasLast = !!j?.lastVisit;
  if (!hasFirst && !hasLast) return { ...first, channel: 'unknown', touch: null, also: null };
  if (last.channel === 'meta_ads') return { ...last, touch: 'last', also: hasFirst && first.channel !== 'meta_ads' ? first.channel : null };
  if (first.channel === 'meta_ads') return { ...first, touch: 'first', also: hasLast ? last.channel : null };
  if (hasLast && last.channel !== 'direct' && last.channel !== 'unknown') return { ...last, touch: 'last', also: hasFirst && first.channel !== last.channel ? first.channel : null };
  if (hasFirst && first.channel !== 'unknown') return { ...first, touch: 'first', also: hasLast && last.channel !== first.channel ? last.channel : null };
  return { ...last, touch: 'last', also: null };
}

/** Long numbers in a UTM value are Meta IDs (campaign / ad set / ad). */
export const isMetaId = (s: string | null | undefined) => !!s && /^\d{10,}$/.test(s);

export type Money = Record<string, number>;
export const addMoney = (m: Money, cur: string, v: number) => { m[cur] = Math.round(((m[cur] ?? 0) + v) * 100) / 100; return m; };

export type AdOrder = { id: string; name: string; at: string; total: number; currency: string; cancelled: boolean; src: OrderSource };
export type AdRow = {
  key: string; campaign: string; ad: string; adset: string | null;
  orders: AdOrder[]; revenue: Money; lastAt: string | null;
};

/** Meta-ad orders grouped by campaign + ad (cancelled orders are listed but not counted in the revenue). */
export function groupByAd(orders: AdOrder[], names: { campaigns?: Record<string, string>; ads?: Record<string, string>; adsets?: Record<string, string> } = {}): AdRow[] {
  const rows = new Map<string, AdRow>();
  for (const o of orders) {
    if (o.src.channel !== 'meta_ads') continue;
    const c = o.src.campaign || '(без названия)';
    const a = o.src.ad || '';
    const key = `${c}|${a}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        key,
        campaign: names.campaigns?.[c] ?? c,
        ad: a ? names.ads?.[a] ?? a : '—',
        adset: o.src.adset ? names.adsets?.[o.src.adset] ?? o.src.adset : null,
        orders: [], revenue: {}, lastAt: null,
      };
      rows.set(key, r);
    }
    r.orders.push(o);
    if (!o.cancelled) addMoney(r.revenue, o.currency, o.total);
    if (!r.lastAt || o.at > r.lastAt) r.lastAt = o.at;
  }
  return [...rows.values()].sort((x, y) => y.orders.filter((o) => !o.cancelled).length - x.orders.filter((o) => !o.cancelled).length || String(y.lastAt).localeCompare(String(x.lastAt)));
}

/** Report period. 'today' / 'yesterday' are calendar days in the shop's time zone (Romania); a number is the last N days. */
export type PeriodKey = 'today' | 'yesterday' | 7 | 14 | 30 | 60 | 90;
export const PERIODS: PeriodKey[] = ['today', 'yesterday', 7, 14, 30, 60, 90];
export const PERIOD_LABEL = (k: PeriodKey) => (k === 'today' ? 'Сегодня' : k === 'yesterday' ? 'Вчера' : `${k} дн.`);
export function parsePeriod(s: string | null | undefined): PeriodKey {
  if (s === 'today' || s === 'yesterday') return s;
  const n = Number(s);
  return (PERIODS as unknown[]).includes(n) ? (n as PeriodKey) : 30;
}

/** Midnight (start of the calendar day) in a time zone, as a UTC Date. */
export function midnightIn(tz: string, at: Date): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = asUtc - Math.floor(at.getTime() / 1000) * 1000; // tz offset at `at`
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - offset);
}

/** [since, until) of a period; until null = now. `day` = local calendar date strings for the Meta report (YYYY-MM-DD). */
export function periodRange(k: PeriodKey, now = new Date(), tz = 'Europe/Bucharest') {
  const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  if (k === 'today') { const s = midnightIn(tz, now); return { since: s, until: null as Date | null, metaSince: ymd(now), metaUntil: ymd(now) }; }
  if (k === 'yesterday') {
    const today0 = midnightIn(tz, now);
    const y = midnightIn(tz, new Date(today0.getTime() - 3600_000));
    return { since: y, until: today0 as Date | null, metaSince: ymd(y), metaUntil: ymd(y) };
  }
  const since = new Date(now.getTime() - k * 86_400_000);
  return { since, until: null as Date | null, metaSince: ymd(new Date(now.getTime() - (k - 1) * 86_400_000)), metaUntil: ymd(now) };
}

// ── Carts → which ad brought the browser (theme UTM visits, AdTouch) ───────────────────────────────
export type TouchRow = { deviceId: string; createdAt: Date | string; source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; term?: string | null; fbclid?: boolean | null; landing?: string | null };
export type AttemptRow = { deviceId: string; event: string; createdAt: Date | string; items?: unknown; total?: number | null; currency?: string | null; orderId?: string | null; host?: string | null };
export type CartItem = { title: string; qty: number; image: string | null; variant: string | null; price: number | null };
const STEP_ORDER = ['cart', 'started', 'contact', 'address', 'shipping', 'payment', 'completed'];
export type CartRow = {
  deviceId: string; first: string; last: string; items: CartItem[]; total: number | null; currency: string | null; host: string | null;
  step: string; orderId: string | null;
  src: { channel: Channel; campaign: string | null; adset: string | null; ad: string | null; at: string; landing: string | null } | null;
};

const ms = (d: Date | string) => +new Date(d);

/** One visit from the theme → channel / campaign / ad (same rules as Shopify's visits). fbclid alone = a Meta ad click without labels. */
export function classifyTouch(t: TouchRow): VisitInfo {
  const v = classifyVisit({ source: t.fbclid ? 'facebook' : 'direct', utmParameters: { source: t.source, medium: t.medium, campaign: t.campaign, content: t.content, term: t.term } });
  if (v.channel === 'facebook' && t.fbclid) return { channel: 'meta_ads', campaign: t.campaign || null, adset: t.term || null, ad: t.content || null };
  return v;
}

export type AdNames = { campaigns: Record<string, string>; ads: Record<string, string> };

/** Names learned from ad visits whose link carried both the campaign name and its id (utm_campaign={{campaign.name}}, utm_id={{campaign.id}}). */
export function learnNames(rows: { campaignId?: string | null; campaign?: string | null }[], into: AdNames = { campaigns: {}, ads: {} }): AdNames {
  for (const r of rows) if (isMetaId(r.campaignId) && r.campaign && !isMetaId(r.campaign)) into.campaigns[r.campaignId!] = r.campaign;
  return into;
}

/** Human label of the ad that brought a visit: campaign name, else ad name, never a bare long number. */
export function adLabel(v: { campaign?: string | null; ad?: string | null }, names: AdNames = { campaigns: {}, ads: {} }): string {
  const nm = (x: string | null | undefined, map: Record<string, string>) => (!x ? null : isMetaId(x) ? map[x] ?? null : x);
  const camp = nm(v.campaign, names.campaigns) ?? nm(v.campaign, names.ads);
  const ad = nm(v.ad, names.ads) ?? nm(v.ad, names.campaigns);
  const id = [v.ad, v.campaign].find((x) => isMetaId(x));
  return camp || ad || (id ? `Reclamă Meta · …${id.slice(-4)}` : 'Reclamă Meta');
}

/** Carts (and checkouts) per browser with the ad that brought it: the last ad visit before the browser's last activity. */
export function cartRows(attempts: AttemptRow[], touches: TouchRow[]): CartRow[] {
  const byDev = new Map<string, AttemptRow[]>();
  for (const a of attempts) (byDev.get(a.deviceId) ?? byDev.set(a.deviceId, []).get(a.deviceId)!).push(a);
  const tByDev = new Map<string, TouchRow[]>();
  for (const t of touches) (tByDev.get(t.deviceId) ?? tByDev.set(t.deviceId, []).get(t.deviceId)!).push(t);
  const out: CartRow[] = [];
  for (const [dev, list] of byDev) {
    list.sort((x, y) => ms(x.createdAt) - ms(y.createdAt));
    const withItems = [...list].reverse().find((a) => Array.isArray(a.items) && (a.items as unknown[]).length);
    if (!withItems) continue;
    const items = (withItems.items as any[]).map((i) => ({ title: String(i?.title || ''), qty: Number(i?.qty) || 1, image: i?.image || null, variant: i?.variant || null, price: i?.price != null && Number.isFinite(Number(i.price)) ? Number(i.price) : null }));
    const step = list.reduce((s, a) => (STEP_ORDER.indexOf(a.event) > STEP_ORDER.indexOf(s) ? a.event : s), 'cart');
    const last = ms(list[list.length - 1].createdAt);
    const ts = (tByDev.get(dev) ?? []).filter((t) => ms(t.createdAt) <= last + 60_000).sort((x, y) => ms(y.createdAt) - ms(x.createdAt));
    // prefer the last visit that came from an ad; otherwise the last labelled visit
    const pick = ts.find((t) => classifyTouch(t).channel === 'meta_ads') ?? ts[0];
    const src = pick ? { ...classifyTouch(pick), at: new Date(pick.createdAt).toISOString(), landing: pick.landing ?? null } : null;
    out.push({
      deviceId: dev, first: new Date(list[0].createdAt).toISOString(), last: new Date(last).toISOString(), items,
      total: withItems.total ?? null, currency: withItems.currency ?? null, host: withItems.host ?? null,
      step, orderId: list.find((a) => a.orderId)?.orderId ?? null, src,
    });
  }
  return out.sort((a, b) => b.last.localeCompare(a.last));
}
