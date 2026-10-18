import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCustomer, redactTargets, mentions, scrubJson, REDACTED } from '../core/redact.ts';
import { runRetention, cutoffs, retentionKey } from '../core/retention.ts';
import { hmacId, shopRef } from '../core/hash.ts';

// ---- tiny in-memory stand-in for the Prisma calls used by core/redact.ts and core/retention.ts ----
function match(row: any, where: any): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries<any>(where)) {
    if (k === 'OR') { if (!cond.some((w: any) => match(row, w))) return false; continue; }
    const v = row[k];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) { if (v !== cond) return false; continue; }
    if ('in' in cond && !cond.in.includes(v)) return false;
    if ('equals' in cond && !(cond.mode === 'insensitive' ? String(v ?? '').toLowerCase() === String(cond.equals).toLowerCase() : v === cond.equals)) return false;
    if ('not' in cond && cond.not === null && (v === null || v === undefined)) return false;
    if ('contains' in cond && !(typeof v === 'string' && v.includes(cond.contains))) return false;
    if ('hasSome' in cond && !(Array.isArray(v) && v.some((x: any) => cond.hasSome.includes(x)))) return false;
    if ('lt' in cond && !(v < cond.lt)) return false;
    if ('gt' in cond && !(v > cond.gt)) return false;
  }
  return true;
}
function model(rows: any[]) {
  const pick = (r: any, select: any) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r });
  return {
    rows,
    async findMany({ where, select, orderBy, take }: any = {}) {
      let out = rows.filter((r) => match(r, where));
      if (orderBy?.id) out = out.sort((a, b) => (a.id < b.id ? -1 : 1));
      if (take) out = out.slice(0, take);
      return out.map((r) => pick(r, select));
    },
    async deleteMany({ where }: any) { const gone = rows.filter((r) => match(r, where)); for (const g of gone) rows.splice(rows.indexOf(g), 1); return { count: gone.length }; },
    async update({ where, data }: any) { const r = rows.find((x) => x.id === where.id); Object.assign(r, data); return r; },
  };
}
const SECRET = 'test-secret';
const SHOP = { id: 's1', domain: 'a.myshopify.com', country: 'RO' };
const h = (k: any, n: string) => hmacId(SECRET, k, n);

function fixture() {
  const ref = shopRef(SECRET, SHOP.domain);
  return {
    blockEntry: model([{ id: 'e1', shopId: 's1', orderId: null }, { id: 'e2', shopId: 's1', orderId: 'gid://shopify/Order/77' }, { id: 'e3', shopId: 's1', orderId: null }]),
    identifier: model([
      { id: 'i1', entryId: 'e1', shopId: 's1', kind: 'email', raw: 'Ana.Pop@gmail.com', normalized: 'anapop@gmail.com', hash: h('email', 'anapop@gmail.com') },
      { id: 'i2', entryId: 'e1', shopId: 's1', kind: 'name', raw: 'Ana Pop', normalized: 'ana pop', hash: h('name', 'ana pop') },
      { id: 'i3', entryId: 'e2', shopId: 's1', kind: 'address', raw: 'Str. X 1', normalized: 'x 1', hash: 'hx' },
      { id: 'i4', entryId: 'e3', shopId: 's1', kind: 'email', raw: 'other@x.ro', normalized: 'other@x.ro', hash: h('email', 'other@x.ro') },
    ]),
    networkReport: model([{ id: 'n1', hash: h('email', 'anapop@gmail.com'), shopRef: ref }, { id: 'n2', hash: h('email', 'anapop@gmail.com'), shopRef: 'other-shop' }, { id: 'n3', hash: h('email', 'other@x.ro'), shopRef: ref }]),
    checkoutAttempt: model([
      { id: 'a1', shopId: 's1', deviceId: 'd1', email: 'ana.pop@gmail.com', phone: null, orderId: null },
      { id: 'a2', shopId: 's1', deviceId: 'd1', email: null, phone: null, orderId: null }, // cart step from the same browser
      { id: 'a3', shopId: 's1', deviceId: 'd2', email: null, phone: '0743 088 138', orderId: null },
      { id: 'a4', shopId: 's1', deviceId: 'd9', email: 'other@x.ro', phone: '0700 000 001', orderId: null },
      { id: 'a5', shopId: 's2', deviceId: 'd1', email: 'ana.pop@gmail.com', phone: null, orderId: null }, // another shop
    ]),
    popupLead: model([{ id: 'p1', shopId: 's1', deviceId: 'd7', email: 'ana.pop@gmail.com' }, { id: 'p2', shopId: 's1', deviceId: 'd9', email: 'other@x.ro' }]),
    emailSend: model([{ id: 'm1', shopId: 's1', deviceId: 'd7', email: 'Ana.Pop@gmail.com', html: '<p>hi</p>' }, { id: 'm2', shopId: 's1', deviceId: 'd9', email: 'other@x.ro', html: '' }]),
    orderCheck: model([
      { id: 'c1', shopId: 's1', orderId: 'gid://shopify/Order/77', personHashes: [], matched: [], networkReasons: null },
      { id: 'c2', shopId: 's1', orderId: 'gid://shopify/Order/80', personHashes: [h('phone', '+40743088138')], matched: [], networkReasons: null },
      { id: 'c3', shopId: 's1', orderId: 'gid://shopify/Order/90', personHashes: [], matched: [{ kind: 'email', normalized: 'anapop@gmail.com', entryId: 'e1' }, { kind: 'name', normalized: 'ion x' }], networkReasons: null },
      { id: 'c4', shopId: 's1', orderId: 'gid://shopify/Order/91', personHashes: [], matched: [{ kind: 'email', normalized: 'other@x.ro' }], networkReasons: null },
    ]),
    deviceEvent: model([{ id: 'v1', shopId: 's1', orderId: 'gid://shopify/Order/77' }, { id: 'v2', shopId: 's1', orderId: 'gid://shopify/Order/91' }]),
    auditLog: model([
      { id: 'l1', shopId: 's1', entryId: 'e1', payload: { added: [{ kind: 'name', raw: 'Ana Pop' }] } },
      { id: 'l2', shopId: 's1', entryId: 'e3', payload: { removed: [{ kind: 'phone', raw: '+40 743-088-138' }, { kind: 'email', raw: 'other@x.ro' }] } },
      { id: 'l3', shopId: 's1', entryId: null, payload: { customer: { email: 'ANA.POP@gmail.com' }, orders_requested: [77] } },
      { id: 'l4', shopId: 's1', entryId: null, payload: null },
    ]),
  };
}

test('redact targets: e-mail / phone spellings, hashes, order gids', () => {
  const t = redactTargets(SECRET, { email: ' Ana.Pop+x@Gmail.com', phone: '+40 743 088 138', orderIds: [77, 'gid://shopify/Order/80', ''] });
  assert.deepEqual(t.emails, ['ana.pop+x@gmail.com', 'anapop@gmail.com']);
  assert.equal(t.phoneN, '+40743088138');
  assert.deepEqual(t.orderGids, ['gid://shopify/Order/77', 'gid://shopify/Order/80']);
  assert.ok(mentions('call 0743.088.138 please', t));
  assert.ok(mentions('a.n.a.pop@googlemail.com', t));
  assert.ok(!mentions('0743 000 999', t));
  const s = scrubJson({ a: ['x', 'anapop@gmail.com'], b: 3 }, t);
  assert.ok(s.changed);
  assert.deepEqual(s.value, { a: ['x', REDACTED], b: 3 });
});

test('customers/redact removes everything of the buyer in that shop, and only that', async () => {
  const db: any = fixture();
  const c = await redactCustomer(db, SECRET, SHOP, { email: 'ana.pop@gmail.com', phone: '0743088138', orderIds: [77, 80] });
  // blacklist: e1 (e-mail) and e2 (order 77) gone with every identifier; e3 (another buyer) untouched
  assert.deepEqual(db.blockEntry.rows.map((r: any) => r.id), ['e3']);
  assert.deepEqual(db.identifier.rows.map((r: any) => r.id), ['i4']);
  // only THIS shop's network report of the buyer is withdrawn
  assert.deepEqual(db.networkReport.rows.map((r: any) => r.id).sort(), ['n2', 'n3']);
  // checkout steps: by e-mail, by phone in another spelling, and the same browser's other steps; other shop untouched
  assert.deepEqual(db.checkoutAttempt.rows.map((r: any) => r.id).sort(), ['a4', 'a5']);
  assert.deepEqual(db.popupLead.rows.map((r: any) => r.id), ['p2']);
  assert.deepEqual(db.emailSend.rows.map((r: any) => r.id), ['m2']);
  // order checks: own orders (77 listed, 80 by phone hash) deleted; c3 scrubbed; c4 untouched
  assert.deepEqual(db.orderCheck.rows.map((r: any) => r.id), ['c3', 'c4']);
  assert.equal(db.orderCheck.rows[0].matched[0].normalized, REDACTED);
  assert.equal(db.orderCheck.rows[0].matched[1].normalized, 'ion x');
  assert.equal(db.orderCheck.rows[1].matched[0].normalized, 'other@x.ro');
  assert.deepEqual(db.deviceEvent.rows.map((r: any) => r.id), ['v2']);
  // activity log: lines of deleted entries gone; the buyer's phone / e-mail replaced elsewhere
  assert.deepEqual(db.auditLog.rows.map((r: any) => r.id), ['l2', 'l3', 'l4']);
  assert.equal(db.auditLog.rows[0].payload.removed[0].raw, REDACTED);
  assert.equal(db.auditLog.rows[0].payload.removed[1].raw, 'other@x.ro');
  assert.equal(db.auditLog.rows[1].payload.customer.email, REDACTED);
  assert.equal(c.entries, 2);
  assert.equal(c.attempts, 3);
  assert.equal(c.orderChecksDeleted, 2);
  assert.equal(c.auditScrubbed, 2);
  // nothing in the shop still mentions the buyer
  const t = redactTargets(SECRET, { email: 'ana.pop@gmail.com', phone: '0743088138' });
  for (const k of ['identifier', 'checkoutAttempt', 'popupLead', 'emailSend', 'orderCheck', 'auditLog']) {
    for (const r of db[k].rows.filter((x: any) => x.shopId === 's1')) assert.ok(!scrubJson(r, t).changed, `${k} ${r.id} still mentions the buyer`);
  }
});

test('customers/redact with an unknown buyer changes nothing', async () => {
  const db: any = fixture();
  const before = JSON.stringify(db);
  const c = await redactCustomer(db, SECRET, SHOP, { email: 'nobody@nowhere.ro', phone: null, orderIds: [] });
  assert.equal(JSON.stringify(db), before);
  assert.equal(Object.values(c).reduce((a: number, b: number) => a + b, 0), 0);
});

test('retention: 120 days checkout steps, 12 months checks / device events / log, expired network reports', async () => {
  const now = new Date('2026-10-19T03:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const db: any = {
    checkoutAttempt: model([{ id: 'a1', createdAt: ago(121) }, { id: 'a2', createdAt: ago(119) }]),
    orderCheck: model([{ id: 'c1', checkedAt: ago(366) }, { id: 'c2', checkedAt: ago(300) }]),
    deviceEvent: model([{ id: 'v1', seenAt: ago(400) }, { id: 'v2', seenAt: ago(1) }]),
    auditLog: model([{ id: 'l1', at: ago(366) }, { id: 'l2', at: ago(10) }]),
    networkReport: model([{ id: 'n1', expiresAt: ago(1) }, { id: 'n2', expiresAt: ago(-30) }]),
  };
  const r = await runRetention(db, now);
  assert.deepEqual(r, { attempts: 1, orderChecks: 1, deviceEvents: 1, audit: 1, network: 1 });
  assert.deepEqual([db.checkoutAttempt, db.orderCheck, db.deviceEvent, db.auditLog, db.networkReport].map((m) => m.rows[0].id), ['a2', 'c2', 'v2', 'l2', 'n2']);
  assert.equal(cutoffs(now).attempts.toISOString(), ago(120).toISOString());
  assert.equal(retentionKey(now), 'retention:2026-10-19');
});
