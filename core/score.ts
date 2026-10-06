// Refuz — scoring an order against the shop's block list + network.
import { normEmail, normPhone, normName, normAddress, normNameAddress, normDevice, type IdKind } from './normalize.ts';

export const WEIGHTS: Record<IdKind, number> = {
  email: 100, phone: 100, name_address: 100, device: 70, address: 60, name: 40,
};
export const WEIGHT_NAME_FUZZY = 20;
export const WEIGHT_DEVICE_IPHONE = 30;

export type Level = 'green' | 'yellow' | 'red';

export interface ShopThresholds { block: number; warn: number } // defaults 100 / 40
export const DEFAULT_THRESHOLDS: ShopThresholds = { block: 100, warn: 40 };

/** Minimal order shape (from orders/create webhook or Admin API). */
export interface OrderLike {
  email?: string | null;
  phone?: string | null;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null;
  shipping_address?: { first_name?: string | null; last_name?: string | null; name?: string | null; phone?: string | null; address1?: string | null; address2?: string | null; city?: string | null; zip?: string | null; country_code?: string | null } | null;
  billing_address?: OrderLike['shipping_address'];
  note_attributes?: Array<{ name: string; value: string }> | null;
  client_details?: { user_agent?: string | null } | null;
}

export interface ExtractedId { kind: IdKind; normalized: string; raw: string }

/** Pull every identifier an order carries, normalized. Duplicates removed. */
export function extractIdentifiers(o: OrderLike, defaultCountry = 'RO'): ExtractedId[] {
  const out: ExtractedId[] = [];
  const seen = new Set<string>();
  const push = (kind: IdKind, raw: string | null | undefined, normalized: string | null) => {
    if (!raw || !normalized) return;
    const k = `${kind}:${normalized}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind, normalized, raw });
  };

  for (const e of [o.email, o.customer?.email]) push('email', e, e ? normEmail(e) : null);
  for (const p of [o.phone, o.customer?.phone, o.shipping_address?.phone, o.billing_address?.phone]) push('phone', p, p ? normPhone(p, defaultCountry) : null);

  const addrs = [o.shipping_address, o.billing_address].filter(Boolean) as NonNullable<OrderLike['shipping_address']>[];
  const names: string[] = [];
  const cust = normName(o.customer?.first_name, o.customer?.last_name);
  if (cust) names.push(cust);
  for (const a of addrs) {
    const n = a.first_name || a.last_name ? normName(a.first_name, a.last_name) : normName(a.name);
    if (n) names.push(n);
    const rawName = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.name || '';
    push('name', rawName, n);
    const ad = normAddress({ address1: a.address1, address2: a.address2, city: a.city, zip: a.zip, country: a.country_code });
    const rawAddr = [a.address1, a.address2, a.city].filter(Boolean).join(', ');
    push('address', rawAddr, ad);
    push('name_address', `${rawName} / ${rawAddr}`, normNameAddress(n, ad));
  }
  if (cust && !names.includes(cust)) push('name', `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`.trim(), cust);

  const dev = o.note_attributes?.find((x) => x.name === '_dev')?.value;
  if (dev) push('device', dev, normDevice(dev));
  return out;
}

export interface Match { kind: IdKind; normalized: string; entryId: string; reason: string; weight: number }

export interface NetworkHit { kind: IdKind; shops: number; reasons: string[] }

export interface ScoreInput {
  ids: ExtractedId[];
  /** lookup: (kind, normalized) → matching own block entries */
  own: (kind: IdKind, normalized: string) => Array<{ entryId: string; reason: string }>;
  /** network answer per identifier (already fetched by hash) */
  network?: (kind: IdKind, normalized: string) => NetworkHit | null;
  isIphone?: boolean;
  thresholds?: ShopThresholds;
}

export interface ScoreResult {
  score: number;
  level: Level;            // own-list level: red = block threshold, yellow = warn threshold
  matches: Match[];
  networkShops: number;    // distinct shops in the network that reported any identifier
  networkLevel: Level;     // green 0, yellow 1–2, red ≥3
  networkReasons: string[];
}

export function networkLevel(shops: number): Level {
  return shops >= 3 ? 'red' : shops >= 1 ? 'yellow' : 'green';
}

export function scoreOrder(inp: ScoreInput): ScoreResult {
  const th = inp.thresholds ?? DEFAULT_THRESHOLDS;
  const matches: Match[] = [];
  const perEntry = new Map<string, number>(); // entryId → max weight contributed (count each entry once per kind)
  let score = 0;

  for (const id of inp.ids) {
    const hits = inp.own(id.kind, id.normalized);
    if (!hits.length) continue;
    let w = WEIGHTS[id.kind];
    if (id.kind === 'device' && inp.isIphone) w = WEIGHT_DEVICE_IPHONE;
    for (const h of hits) {
      const key = `${h.entryId}:${id.kind}`;
      if (perEntry.has(key)) continue;
      perEntry.set(key, w);
      matches.push({ kind: id.kind, normalized: id.normalized, entryId: h.entryId, reason: h.reason, weight: w });
    }
  }
  // Score = strongest single entry (sum of its distinct kinds), not a sum across unrelated entries.
  const byEntry = new Map<string, number>();
  for (const m of matches) byEntry.set(m.entryId, (byEntry.get(m.entryId) ?? 0) + m.weight);
  for (const v of byEntry.values()) score = Math.max(score, v);
  // Avoid double-counting name+address when name_address already matched the same entry.
  for (const [entryId, v] of byEntry) {
    const kinds = matches.filter((m) => m.entryId === entryId).map((m) => m.kind);
    if (kinds.includes('name_address')) {
      const adj = v - (kinds.includes('name') ? WEIGHTS.name : 0) - (kinds.includes('address') ? WEIGHTS.address : 0);
      score = Math.max(score === v ? adj : score, adj);
    }
  }

  let networkShops = 0;
  const reasons = new Set<string>();
  if (inp.network) {
    for (const id of inp.ids) {
      if (!['email', 'phone', 'name_address'].includes(id.kind)) continue;
      const hit = inp.network(id.kind, id.normalized);
      if (!hit) continue;
      networkShops = Math.max(networkShops, hit.shops);
      hit.reasons.forEach((r) => reasons.add(r));
    }
  }

  const level: Level = score >= th.block ? 'red' : score >= th.warn ? 'yellow' : 'green';
  return { score, level, matches, networkShops, networkLevel: networkLevel(networkShops), networkReasons: [...reasons] };
}

/** Combined traffic light shown to the merchant: own list always wins. */
export function combinedLevel(r: ScoreResult): Level {
  const rank = { green: 0, yellow: 1, red: 2 } as const;
  return rank[r.level] >= rank[r.networkLevel] ? r.level : r.networkLevel;
}
