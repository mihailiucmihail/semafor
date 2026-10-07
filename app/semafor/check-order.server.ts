// Refuz — full server-side check run from the orders/create webhook (via job queue).
// 1) extract + normalize identifiers  2) look up own list  3) ask network  4) score
// 5) write OrderCheck  6) act in Shopify: tag + risk assessment (+ optional cancel)
import type { PrismaClient } from '@prisma/client';
import { extractIdentifiers, scoreOrder, combinedLevel, type ScoreResult, type Level } from '../../core/score';
import { hmacId } from '../../core/hash';
import type { IdKind } from '../../core/normalize';

import { type ShopSettings } from '../../core/settings';
import { deviceLinks } from './device-links.server';

export interface AdminClient { graphql(q: string, opts?: { variables?: Record<string, unknown> }): Promise<Response> }
async function gql(admin: AdminClient, q: string, variables?: Record<string, unknown>) { const r = await admin.graphql(q, { variables }); const j = await r.json(); return j; }

// Visible in the Orders list (Tags column) — the whole point: see the traffic light without opening the app.
// A text traffic light: the active lamp lit, the other two dark.
export const TAG: Record<Level, string> = { red: '🔴⚫⚫', yellow: '⚫🟡⚫', green: '⚫⚫🟢' };
const ALL_TAGS = [...Object.values(TAG), '🔴 Semafor', '🟡 Semafor', '🟢 Semafor', 'refuz:blocked', 'refuz:warn'];

export async function checkOrder(opts: {
  db: PrismaClient; secret: string; shopId: string; shopDomain: string; country: string;
  settings: ShopSettings; order: any; admin: AdminClient; skipCancel?: boolean;
}): Promise<ScoreResult & { combined: Level; action: string }> {
  const { db, secret, shopId, settings, order, admin } = opts;
  const ids = extractIdentifiers(order, opts.country);
  const isIphone = /iPhone/i.test(order.client_details?.user_agent ?? '');

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
    const k = `${r.kind}:${r.normalized}`;
    ownMap.set(k, [...(ownMap.get(k) ?? []), { entryId: r.entry.id, reason: r.entry.reason }]);
  }

  // Network: only when the shop shares; only strong kinds.
  let netMap = new Map<string, { kind: IdKind; shops: number; reasons: string[] }>();
  if (settings.shareNetwork) {
    const strong = hashes.filter((h) => ['email', 'phone', 'name_address'].includes(h.kind));
    const reports = await db.networkReport.findMany({ where: { hash: { in: strong.map((h) => h.hash) }, expiresAt: { gt: now } }, select: { hash: true, kind: true, reason: true, shopRef: true } });
    for (const h of strong) {
      const mine = (reports as any[]).filter((r) => r.hash === h.hash);
      if (!mine.length) continue;
      netMap.set(`${h.kind}:${h.normalized}`, { kind: h.kind, shops: new Set(mine.map((r) => r.shopRef)).size, reasons: [...new Set(mine.map((r) => r.reason as string))] });
    }
  }

  const result = scoreOrder({
    ids, isIphone, thresholds: settings.thresholds,
    own: (k, n) => ownMap.get(`${k}:${n}`) ?? [],
    network: (k, n) => netMap.get(`${k}:${n}`) ?? null,
  });
  // Device chain: identities tried from the same device in checkout (Semafor pixel)
  try {
    const dl = await deviceLinks(db, secret, shopId, order.checkout_token, opts.country);
    if (dl.findings.length) {
      result.matches.push(...(dl.findings as any));
      result.score += Math.max(...dl.findings.map((f) => f.weight));
      const lvl = result.score >= settings.thresholds.block ? 'red' : result.score >= settings.thresholds.warn ? 'yellow' : 'green';
      const rank = { green: 0, yellow: 1, red: 2 } as const;
      if (rank[lvl] > rank[result.level]) result.level = lvl;
    }
    if (order.checkout_token) await db.checkoutAttempt.updateMany({ where: { shopId, checkoutToken: order.checkout_token }, data: { orderId: order.admin_graphql_api_id } });
  } catch (e) { console.error('[semafor] deviceLinks', e); }
  const combined = combinedLevel(result);

  // Device trail
  const dev = ids.find((i) => i.kind === 'device');
  if (dev) await db.deviceEvent.create({ data: { shopId, deviceHash: dev.normalized, orderId: order.admin_graphql_api_id } });

  // Act in Shopify
  let action = 'tag';
  {
    const tag = TAG[combined];
    const cur: any = await gql(admin, `#graphql
      query($id:ID!){ order(id:$id){ tags } }`, { id: order.admin_graphql_api_id });
    const present: string[] = cur?.data?.order?.tags ?? [];
    const stale = present.filter((t) => t !== tag && ALL_TAGS.includes(t));
    if (stale.length) {
      const r: any = await gql(admin, `#graphql
        mutation($id:ID!,$tags:[String!]!){ tagsRemove(id:$id,tags:$tags){ userErrors{ message } } }`, { id: order.admin_graphql_api_id, tags: stale });
      const ue = r?.data?.tagsRemove?.userErrors; if (ue?.length || r?.errors) console.error('[semafor] tagsRemove', JSON.stringify(ue || r.errors));
    }
    await gql(admin, `#graphql
      mutation($id:ID!,$tags:[String!]!){ tagsAdd(id:$id,tags:$tags){ userErrors{ message } } }`, { id: order.admin_graphql_api_id, tags: [tag] });
  }
  if (combined !== 'green') {
    const facts = result.matches.map((m) => ({ description: m.kind === 'device' ? `Semafor: ${m.normalized}` : `Semafor: ${labelKind(m.kind)} în lista neagră (${m.reason})`, sentiment: 'NEGATIVE' }));
    if (result.networkShops) facts.push({ description: `Semafor: raportat de ${result.networkShops} magazin(e) din rețea`, sentiment: 'NEGATIVE' });
    await gql(admin,
      `#graphql
      mutation($in:OrderRiskAssessmentCreateInput!){ orderRiskAssessmentCreate(orderRiskAssessmentInput:$in){ userErrors{ message } } }`,
      { in: { orderId: order.admin_graphql_api_id, riskLevel: combined === 'red' ? 'HIGH' : 'MEDIUM', facts } },
    );
    action = 'tag+risk';
    if (combined === 'red' && settings.cancelRed && !opts.skipCancel) {
      await gql(admin, `#graphql
      mutation($id:ID!){ orderCancel(orderId:$id, reason:FRAUD, notifyCustomer:false, refund:false, restock:true){ userErrors{ message } } }`, { id: order.admin_graphql_api_id });
      action = 'tag+risk+cancel';
    }
  }

  await db.orderCheck.upsert({
    where: { shopId_orderId: { shopId, orderId: order.admin_graphql_api_id } },
    create: { shopId, orderId: order.admin_graphql_api_id, orderName: order.name, score: result.score, level: result.level, networkShops: result.networkShops, networkLevel: result.networkLevel, matched: result.matches as any, actionTaken: action },
    update: { score: result.score, level: result.level, networkShops: result.networkShops, networkLevel: result.networkLevel, matched: result.matches as any, actionTaken: action, checkedAt: now },
  });

  return { ...result, combined, action };
}

function labelKind(k: IdKind): string {
  return { email: 'e-mail', phone: 'telefon', name: 'nume', address: 'adresă', name_address: 'nume + adresă', device: 'dispozitiv' }[k];
}
