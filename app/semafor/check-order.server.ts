// Refuz — full server-side check run from the orders/create webhook (via job queue).
// 1) extract + normalize identifiers  2) look up own list  3) ask network  4) score
// 5) write OrderCheck  6) act in Shopify: tag + risk assessment (+ optional cancel)
import type { PrismaClient } from '@prisma/client';
import { extractIdentifiers, scoreOrder, combinedLevel, deviceExpired, type ScoreResult, type Level } from '../../core/score';
import { hmacId, shopRef } from '../../core/hash';
import type { IdKind } from '../../core/normalize';

import { networkOf, type ShopSettings } from '../../core/settings';
import { can, effectiveSettings } from '../../core/plans';
import { planOf } from './plan.server';
import { deviceLinks } from './device-links.server';
import { findRelated, personHashes, personHistory, pastOrderText, stillOpenReturns, openReturnText, OPEN_RETURN_REASON } from './open-cod.server';
import { shopLang } from '../i18n.server';
import { attributeOrder } from './attribution.server';

export interface AdminClient { graphql(q: string, opts?: { variables?: Record<string, unknown> }): Promise<Response> }
async function gql(admin: AdminClient, q: string, variables?: Record<string, unknown>) { const r = await admin.graphql(q, { variables }); const j = await r.json(); return j; }

// Visible in the Orders list (Tags column) — the whole point: see the traffic light without opening the app.
// A text traffic light: the active lamp lit, the other two dark.
export const TAG: Record<Level, string> = { red: '🔴⚫⚫', yellow: '⚫🟡⚫', green: '⚫⚫🟢' };
/** Same person ordered before (any e-mail): visible in the Orders list next to the light. */
export const RETURNING_TAG = 'Semafor · client revenit';
const ALL_TAGS = [...Object.values(TAG), '🔴 Semafor', '🟡 Semafor', '🟢 Semafor', 'refuz:blocked', 'refuz:warn'];

export async function checkOrder(opts: {
  db: PrismaClient; secret: string; shopId: string; shopDomain: string; country: string;
  settings: ShopSettings; order: any; admin: AdminClient; skipCancel?: boolean;
  /** periodic re-check (app/semafor/recheck.server.ts): Shopify risk is written only when the light changed */
  recheck?: boolean;
  /** write the returning-customer note to Shopify even if the order was checked before (admin re-run) */
  forceNote?: boolean;
  /** orders of the same person with a return request still unsettled, found after this order was placed (recheck.server.ts) */
  openReturns?: { id: string; name: string }[];
}): Promise<ScoreResult & { combined: Level; action: string; related: string[] }> {
  const { db, secret, shopId, order, admin } = opts;
  const plan = planOf(await db.shop.findUnique({ where: { id: shopId }, select: { plan: true, domain: true, trialEndsAt: true } }));
  const settings = effectiveSettings(opts.settings, plan);
  const ids = extractIdentifiers(order, opts.country);
  const isIphone = /iPhone/i.test(order.client_details?.user_agent ?? '');
  const ro = shopLang({ id: shopId, domain: opts.shopDomain, settings: opts.settings }) === 'ro';

  // Own list: one query for all hashes.
  const hashes = ids.map((i) => ({ kind: i.kind, hash: hmacId(secret, i.kind, i.normalized), normalized: i.normalized }));
  const rows = await db.identifier.findMany({
    where: { shopId, OR: hashes.map((h) => ({ kind: h.kind, hash: h.hash })) },
    include: { entry: { select: { id: true, reason: true, expiresAt: true } } },
  });
  const now = new Date();
  const ownMap = new Map<string, Array<{ entryId: string; reason: string }>>();
  for (const r of rows as any[]) {
    if (r.entry.expiresAt && r.entry.expiresAt < now) continue;
    if (deviceExpired(r.kind, r.createdAt, +now)) continue;
    const k = `${r.kind}:${r.normalized}`;
    ownMap.set(k, [...(ownMap.get(k) ?? []), { entryId: r.entry.id, reason: r.entry.reason }]);
  }

  // Network: only when the shop shares; only strong kinds.
  let netMap = new Map<string, { kind: IdKind; shops: number; reasons: string[]; byReason?: Record<string, number> }>();
  if (settings.shareNetwork) {
    const ownRef = shopRef(secret, opts.shopDomain);
    const net = networkOf(settings.network);
    const strong = hashes.filter((h) => ['email', 'phone', 'name_address'].includes(h.kind));
    const reports = await db.networkReport.findMany({ where: { hash: { in: strong.map((h) => h.hash) }, expiresAt: { gt: now } }, select: { hash: true, kind: true, reason: true, shopRef: true } });
    for (const h of strong) {
      // the network = OTHER shops (this shop's own reports are already in its own list), only the reasons the shop counts
      const mine = (reports as any[]).filter((r) => r.hash === h.hash && r.shopRef !== ownRef && (net.reasons as string[]).includes(r.reason));
      if (!mine.length) continue;
      const byReason: Record<string, number> = {};
      for (const r of new Set(mine.map((r) => r.reason as string))) byReason[r] = new Set(mine.filter((m) => m.reason === r).map((m) => m.shopRef)).size;
      netMap.set(`${h.kind}:${h.normalized}`, { kind: h.kind, shops: new Set(mine.map((r) => r.shopRef)).size, reasons: Object.keys(byReason), byReason });
    }
  }

  const result = scoreOrder({
    ids, isIphone, thresholds: settings.thresholds, networkThresholds: networkOf(settings.network),
    own: (k, n) => ownMap.get(`${k}:${n}`) ?? [],
    network: (k, n) => netMap.get(`${k}:${n}`) ?? null,
  });
  // Device chain: identities tried from the same device in checkout (Semafor pixel)
  if (can(plan, 'device_links')) try {
    const dl = await deviceLinks(db, secret, shopId, order.checkout_token, opts.country, true, order.admin_graphql_api_id,
      { email: order.email || order.customer?.email, phone: order.phone || order.shipping_address?.phone || order.customer?.phone, firstName: order.shipping_address?.first_name || order.customer?.first_name, lastName: order.shipping_address?.last_name || order.customer?.last_name }, admin as any);
    if (dl.findings.length) {
      result.matches.push(...(dl.findings as any));
      result.score += Math.max(...dl.findings.map((f) => f.weight));
      const lvl = result.score >= settings.thresholds.block ? 'red' : result.score >= settings.thresholds.warn ? 'yellow' : 'green';
      const rank = { green: 0, yellow: 1, red: 2 } as const;
      if (rank[lvl] > rank[result.level]) result.level = lvl;
    }
    if (order.checkout_token) await db.checkoutAttempt.updateMany({ where: { shopId, checkoutToken: order.checkout_token }, data: { orderId: order.admin_graphql_api_id } });
  } catch (e) { console.error('[semafor] deviceLinks', e); }
  // Other open orders of the same customer → at least yellow
  let related: string[] = [];
  try {
    const ph = personHashes(secret, order, opts.country);
    const others = ph.length ? await db.orderCheck.findMany({ where: { shopId, personHashes: { hasSome: ph }, orderId: { not: order.admin_graphql_api_id }, checkedAt: { gt: new Date(Date.now() - 30 * 86_400_000) } }, select: { orderId: true }, take: 15 }) : [];
    const r = await findRelated(admin as any, order, { country: opts.country, otherIds: others.map((o) => o.orderId) });
    related = r.ids;
    // stored in Romanian (the canonical form); trMsg translates it for the admin language when shown
    if (r.unshipped.length) (result.matches as any[]).push({ kind: 'order', normalized: `clientul are încă ${r.unshipped.length === 1 ? 'o comandă neexpediată' : r.unshipped.length + ' comenzi neexpediate'}: ${r.unshipped.join(', ')} — se pot uni într-un singur colet`, entryId: '', reason: 'mai multe comenzi', weight: 40 });
    for (const n of r.codInTransit) (result.matches as any[]).push({ kind: 'order', normalized: `are deja comanda ${n} cu ramburs, în drum — așteaptă să o ridice`, entryId: '', reason: 'comandă în drum', weight: 40 });
    if ((r.unshipped.length || r.codInTransit.length) && result.level === 'green') result.level = 'yellow';
  } catch (e) { console.error('[semafor] findRelated', e); }
  // Earlier orders of the same person (also delivered ones, also under another e-mail): always shown as a note;
  // a refused parcel / return / refund among them → at least yellow.
  let history: string | null = null;
  // the returning-customer note goes to Shopify's risk panel once, at the order's first check
  const firstCheck = !opts.recheck && !(await db.orderCheck.findUnique({ where: { shopId_orderId: { shopId, orderId: order.admin_graphql_api_id } }, select: { orderId: true } }));
  const HIST_REASONS = ['client revenit', 'istoric retur/refuz'];
  // orders of the same person with an unsettled return request → red (ship nothing before the return is sorted out)
  let returnIds: string[] = (opts.openReturns ?? []).map((x) => x.id);
  let prevReturn: any = null;
  if (opts.recheck) {
    // periodic re-checks reuse what the first check found (saves 3 Shopify calls per order every 15 min)
    const prevCheck: any = await db.orderCheck.findUnique({ where: { shopId_orderId: { shopId, orderId: order.admin_graphql_api_id } }, select: { matched: true } });
    prevReturn = ((prevCheck?.matched as any[]) ?? []).find((x) => x?.reason === OPEN_RETURN_REASON) ?? null;
    if (prevReturn?.orders?.length) returnIds.push(...prevReturn.orders);
    const m = ((prevCheck?.matched as any[]) ?? []).find((x) => HIST_REASONS.includes(x?.reason));
    if (m) {
      history = m.normalized;
      (result.matches as any[]).push(m);
      if (m.weight > 0 && result.level === 'green') result.level = 'yellow';
    }
  } else try {
    const ph = personHashes(secret, order, opts.country);
    const past = ph.length ? await db.orderCheck.findMany({ where: { shopId, personHashes: { hasSome: ph }, orderId: { not: order.admin_graphql_api_id } }, select: { orderId: true }, orderBy: { checkedAt: 'desc' }, take: 30 }) : [];
    const h = await personHistory(admin as any, order, opts.country, past.map((o) => o.orderId));
    if (h.length) {
      history = `client revenit — comenzi anterioare: ${h.map(pastOrderText).join(', ')}`;
      const bad = h.filter((x) => x.bad);
      (result.matches as any[]).push({ kind: 'order', normalized: history, entryId: '', reason: bad.length ? 'istoric retur/refuz' : 'client revenit', weight: bad.length ? 40 : 0 });
      if (bad.length && result.level === 'green') result.level = 'yellow';
      returnIds.push(...h.filter((x) => x.openReturn).map((x) => x.id));
    }
  } catch (e) { console.error('[semafor] personHistory', e); }
  // the level without the return finding: auto-cancel (settings.cancelRed) never fires just because of a return request
  const levelBeforeReturn = result.level;
  returnIds = [...new Set(returnIds)].filter((id) => id !== order.admin_graphql_api_id);
  if (returnIds.length) try {
    const open = await stillOpenReturns(admin as any, returnIds);
    if (open.length) {
      (result.matches as any[]).push({ kind: 'order', normalized: openReturnText(open.map((o) => o.name)), entryId: '', reason: OPEN_RETURN_REASON, weight: 100, orders: open.map((o) => o.id) });
      result.level = 'red';
    }
  } catch (e) {
    // Shopify didn't answer: keep the last known finding rather than turning the light green by mistake
    console.error('[semafor] open returns', e);
    const keep = prevReturn ?? ((opts.openReturns ?? []).length ? { kind: 'order', normalized: openReturnText(opts.openReturns!.map((o) => o.name)), entryId: '', reason: OPEN_RETURN_REASON, weight: 100, orders: opts.openReturns!.map((o) => o.id) } : null);
    if (keep) { (result.matches as any[]).push(keep); result.level = 'red'; }
  }
  const combined = combinedLevel(result);

  // Device trail
  const dev = ids.find((i) => i.kind === 'device');
  if (dev) await db.deviceEvent.create({ data: { shopId, deviceHash: dev.normalized, orderId: order.admin_graphql_api_id } });

  // Act in Shopify
  let action = 'tag';
  const prev = opts.recheck ? await db.orderCheck.findUnique({ where: { shopId_orderId: { shopId, orderId: order.admin_graphql_api_id } }, select: { level: true, networkLevel: true } }) : null;
  const prevLevel: Level | null = prev ? (({ green: 0, yellow: 1, red: 2 } as const)[prev.level as Level] >= ({ green: 0, yellow: 1, red: 2 } as const)[prev.networkLevel as Level] ? prev.level as Level : prev.networkLevel as Level) : null;
  const changed = !opts.recheck || prevLevel !== combined;
  let staleRisk = false; // Shopify still shows an older yellow/red Semafor assessment
  {
    const tag = TAG[combined];
    const cur: any = await gql(admin, `#graphql
      query($id:ID!){ order(id:$id){ tags risk{ assessments{ riskLevel provider{ title } } } } }`, { id: order.admin_graphql_api_id });
    const present: string[] = cur?.data?.order?.tags ?? [];
    const ours = ((cur?.data?.order?.risk?.assessments ?? []) as any[]).filter((a) => /semafor/i.test(a?.provider?.title || ''));
    staleRisk = !!ours.length && ours[ours.length - 1].riskLevel !== 'NONE';
    const stale = present.filter((t) => t !== tag && ALL_TAGS.includes(t));
    if (stale.length) {
      const r: any = await gql(admin, `#graphql
        mutation($id:ID!,$tags:[String!]!){ tagsRemove(id:$id,tags:$tags){ userErrors{ message } } }`, { id: order.admin_graphql_api_id, tags: stale });
      const ue = r?.data?.tagsRemove?.userErrors; if (ue?.length || r?.errors) console.error('[semafor] tagsRemove', JSON.stringify(ue || r.errors));
    }
    await gql(admin, `#graphql
      mutation($id:ID!,$tags:[String!]!){ tagsAdd(id:$id,tags:$tags){ userErrors{ message } } }`, { id: order.admin_graphql_api_id, tags: history ? [tag, RETURNING_TAG] : [tag] });
  }
  if (combined === 'green' && ((opts.recheck && changed) || staleRisk || (history && (firstCheck || opts.forceNote)))) {
    // the reason is gone (e.g. the other order was delivered): Shopify shows Semafor's latest assessment;
    // a returning customer is shown there too (as information, the light stays green)
    const facts = [{ description: (opts.recheck || staleRisk) ? 'Semafor: verificat din nou — nimic de semnalat' : 'Semafor: verificat — nimic de semnalat', sentiment: 'POSITIVE' }];
    if (history) facts.push({ description: `Semafor: ${history}`, sentiment: 'NEUTRAL' });
    await gql(admin, `#graphql
      mutation($in:OrderRiskAssessmentCreateInput!){ orderRiskAssessmentCreate(orderRiskAssessmentInput:$in){ userErrors{ message } } }`,
      { in: { orderId: order.admin_graphql_api_id, riskLevel: 'NONE', facts } });
  }
  if (combined !== 'green' && changed) {
    const facts = result.matches.map((m) => ({ description: (m.kind as string) === 'device' || (m.kind as string) === 'order' ? `Semafor: ${m.normalized}` : (ro ? `Semafor: ${labelKind(m.kind, true)} în lista neagră (${m.reason})` : `Semafor: ${labelKind(m.kind, false)} is on the blacklist (${REASON_EN[m.reason as string] ?? m.reason})`), sentiment: 'NEGATIVE' }));
    if (result.networkShops) facts.push({ description: (ro ? `Semafor: raportat de ${result.networkShops} magazin(e) din rețea` : `Semafor: reported by ${result.networkShops} store(s) in the network`), sentiment: 'NEGATIVE' });
    await gql(admin,
      `#graphql
      mutation($in:OrderRiskAssessmentCreateInput!){ orderRiskAssessmentCreate(orderRiskAssessmentInput:$in){ userErrors{ message } } }`,
      { in: { orderId: order.admin_graphql_api_id, riskLevel: combined === 'red' ? 'HIGH' : 'MEDIUM', facts } },
    );
    action = 'tag+risk';
    if (combined === 'red' && combinedLevel({ ...result, level: levelBeforeReturn }) === 'red' && settings.cancelRed && !opts.skipCancel) {
      await gql(admin, `#graphql
      mutation($id:ID!){ orderCancel(orderId:$id, reason:FRAUD, notifyCustomer:false, refund:false, restock:true){ userErrors{ message } } }`, { id: order.admin_graphql_api_id });
      action = 'tag+risk+cancel';
    }
  }

  await db.orderCheck.upsert({
    where: { shopId_orderId: { shopId, orderId: order.admin_graphql_api_id } },
    create: { shopId, orderId: order.admin_graphql_api_id, orderName: order.name, personHashes: personHashes(secret, order, opts.country), score: result.score, level: result.level, networkShops: result.networkShops, networkLevel: result.networkLevel, networkReasons: (result.networkShops ? result.networkByReason : undefined) as any, matched: result.matches as any, actionTaken: action },
    update: { personHashes: personHashes(secret, order, opts.country), score: result.score, level: result.level, networkShops: result.networkShops, networkLevel: result.networkLevel, networkReasons: (result.networkShops ? result.networkByReason : undefined) as any, matched: result.matches as any, actionTaken: action, ...(opts.recheck ? {} : { checkedAt: now }) },
  });

  // Was it brought by Semafor (pop-up / reminder e-mail)? Only for new orders (webhook), not for re-checks / backfill.
  if (!opts.skipCancel) await attributeOrder(db, admin, { id: shopId, domain: opts.shopDomain, settings: opts.settings }, order);

  return { ...result, combined, action, related };
}

const REASON_EN: Record<string, string> = { return_no_reason: 'frequent returns without a valid reason', refuz_colet: 'refused COD parcel', chargeback: 'chargeback', return_fraud: 'return fraud', abuse: 'abuse', other: 'other' };

function labelKind(k: IdKind, ro: boolean): string {
  return ro
    ? { email: 'e-mail', phone: 'telefon', name: 'nume', address: 'adresă', name_address: 'nume + adresă', device: 'dispozitiv' }[k]
    : { email: 'e-mail', phone: 'phone', name: 'name', address: 'address', name_address: 'name + address', device: 'device' }[k];
}
