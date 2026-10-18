// GDPR erasure (Shopify customers/redact) for ONE buyer of ONE shop.
// Everything Semafor holds about the buyer in that shop is deleted, or — inside records that also describe other
// people (order-check matches, the activity log) — the buyer's values are replaced by "[redacted]".
// The buyer is matched by the e-mail / phone of the webhook payload and by the order ids Shopify lists.
//
// `db` is the Prisma client (or a test double with the same calls); only plain where-shapes are used:
// equality, { in }, { not: null }, { equals, mode: "insensitive" }, { hasSome }, { gt } on id for paging.
import { normEmail, normPhone } from './normalize.ts';
import { hmacId, shopRef } from './hash.ts';

export const REDACTED = '[redacted]';

export interface RedactInput { email?: string | null; phone?: string | null; orderIds?: Array<string | number> | null }
export interface RedactShop { id: string; domain: string; country?: string | null }
export interface RedactCounts {
  entries: number; networkReports: number; attempts: number; popupLeads: number; emailSends: number;
  orderChecksDeleted: number; orderChecksScrubbed: number; deviceEvents: number; auditDeleted: number; auditScrubbed: number;
}

/** What identifies the buyer: e-mail / phone in every useful spelling, their HMACs, Shopify order gids. */
export function redactTargets(secret: string, input: RedactInput, country = 'RO') {
  const email = (input.email || '').trim();
  const emailN = email ? normEmail(email) : null;
  const phone = (input.phone || '').trim();
  const phoneN = phone ? normPhone(phone, country) : null;
  const hashes: string[] = [];
  if (emailN) hashes.push(hmacId(secret, 'email', emailN));
  if (phoneN) hashes.push(hmacId(secret, 'phone', phoneN));
  const orderGids = [...new Set((input.orderIds || []).filter((x) => x !== null && x !== undefined && String(x).trim() !== '').map((x) => {
    const s = String(x).trim();
    return s.startsWith('gid://') ? s : `gid://shopify/Order/${s.split('/').pop()}`;
  }))];
  const emails = [...new Set([email.toLowerCase(), emailN || ''].filter(Boolean))];
  return { email: email.toLowerCase() || null, emailN, emails, phone: phone || null, phoneN, hashes, orderGids };
}
export type Targets = ReturnType<typeof redactTargets>;

/** Does a free-text value mention the buyer (their e-mail, or their phone in any formatting)? */
export function mentions(s: string, t: Targets, country = 'RO'): boolean {
  if (!s) return false;
  const low = s.toLowerCase();
  for (const e of t.emails) if (low.includes(e)) return true;
  if (t.emailN && /@/.test(low)) {
    for (const w of low.split(/[\s,;<>()"']+/)) if (w.includes('@') && normEmail(w) === t.emailN) return true;
  }
  if (t.phoneN) {
    const d = s.replace(/\D/g, '');
    const nsn = t.phoneN.replace(/\D/g, '').slice(-9); // national significant number (last 9 digits)
    if (d.length >= 7 && nsn.length >= 7 && d.includes(nsn)) return true;
    if (d.length >= 7 && normPhone(s, country) === t.phoneN) return true;
  }
  return false;
}

/** Deep copy of a JSON value with every string that mentions the buyer replaced by "[redacted]". */
export function scrubJson(v: unknown, t: Targets, country = 'RO'): { value: unknown; changed: boolean } {
  let changed = false;
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') { if (x !== REDACTED && mentions(x, t, country)) { changed = true; return REDACTED; } return x; }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') { const o: Record<string, unknown> = {}; for (const [k, val] of Object.entries(x)) o[k] = walk(val); return o; }
    return x;
  };
  const value = walk(v);
  return { value, changed };
}

const BATCH = 1000;
async function* pages(model: any, where: Record<string, unknown>, select: Record<string, boolean>) {
  let last: string | null = null;
  for (;;) {
    const rows: any[] = await model.findMany({ where: last ? { ...where, id: { gt: last } } : where, select: { id: true, ...select }, orderBy: { id: 'asc' }, take: BATCH });
    if (!rows.length) return;
    yield rows;
    if (rows.length < BATCH) return;
    last = rows[rows.length - 1].id;
  }
}

export async function redactCustomer(db: any, secret: string, shop: RedactShop, input: RedactInput): Promise<RedactCounts> {
  const country = shop.country || 'RO';
  const t = redactTargets(secret, input, country);
  const c: RedactCounts = { entries: 0, networkReports: 0, attempts: 0, popupLeads: 0, emailSends: 0, orderChecksDeleted: 0, orderChecksScrubbed: 0, deviceEvents: 0, auditDeleted: 0, auditScrubbed: 0 };
  const shopId = shop.id;
  const ids = (rows: any[]) => rows.map((r) => r.id as string);

  // 1. blacklist entries about the buyer (by e-mail / phone hash, or created from one of their orders) — deleted with
  //    every identifier (name, address, device too), their network reports and their activity-log lines.
  const entryIds = new Set<string>();
  if (t.hashes.length) for (const r of await db.identifier.findMany({ where: { shopId, hash: { in: t.hashes } }, select: { entryId: true } })) entryIds.add(r.entryId);
  if (t.orderGids.length) for (const r of await db.blockEntry.findMany({ where: { shopId, orderId: { in: t.orderGids } }, select: { id: true } })) entryIds.add(r.id);
  if (entryIds.size) {
    const eids = [...entryIds];
    const hs: string[] = (await db.identifier.findMany({ where: { entryId: { in: eids } }, select: { hash: true } })).map((r: any) => r.hash);
    if (hs.length) c.networkReports = (await db.networkReport.deleteMany({ where: { shopRef: shopRef(secret, shop.domain), hash: { in: [...new Set(hs)] } } })).count;
    c.auditDeleted += (await db.auditLog.deleteMany({ where: { shopId, entryId: { in: eids } } })).count;
    await db.identifier.deleteMany({ where: { entryId: { in: eids } } });
    c.entries = (await db.blockEntry.deleteMany({ where: { shopId, id: { in: eids } } })).count;
  }

  // 2. checkout steps: by e-mail, phone (any spelling), order — and everything else from the same browsers.
  const att = new Map<string, string>(); // id → deviceId
  const take = (rows: any[]) => rows.forEach((r) => att.set(r.id, r.deviceId));
  for (const e of t.emails) take(await db.checkoutAttempt.findMany({ where: { shopId, email: { equals: e, mode: 'insensitive' } }, select: { id: true, deviceId: true } }));
  if (t.phoneN) {
    // phones are stored as typed ("0743 088 138", "+40743088138"…): compare normalised, page by page
    for await (const rows of pages(db.checkoutAttempt, { shopId, phone: { not: null } }, { deviceId: true, phone: true })) {
      take(rows.filter((r: any) => r.phone && (normPhone(r.phone, country) === t.phoneN || mentions(r.phone, t, country))));
    }
  }
  if (t.orderGids.length) take(await db.checkoutAttempt.findMany({ where: { shopId, orderId: { in: t.orderGids } }, select: { id: true, deviceId: true } }));
  const leadsByMail = t.emails.length ? await db.popupLead.findMany({ where: { shopId, email: { in: t.emails } }, select: { id: true, deviceId: true } }) : [];
  const devices = [...new Set([...att.values(), ...leadsByMail.map((r: any) => r.deviceId)].filter(Boolean))];
  if (devices.length) take(await db.checkoutAttempt.findMany({ where: { shopId, deviceId: { in: devices } }, select: { id: true, deviceId: true } }));
  if (att.size) c.attempts = (await db.checkoutAttempt.deleteMany({ where: { shopId, id: { in: [...att.keys()] } } })).count;

  // 3. pop-up sign-ups and e-mails sent (recipient + the e-mail as sent)
  const leadIds = new Set<string>(ids(leadsByMail));
  if (devices.length) for (const r of await db.popupLead.findMany({ where: { shopId, deviceId: { in: devices } }, select: { id: true } })) leadIds.add(r.id);
  if (leadIds.size) c.popupLeads = (await db.popupLead.deleteMany({ where: { shopId, id: { in: [...leadIds] } } })).count;
  const sendIds = new Set<string>();
  for (const e of t.emails) for (const r of await db.emailSend.findMany({ where: { shopId, email: { equals: e, mode: 'insensitive' } }, select: { id: true } })) sendIds.add(r.id);
  if (devices.length) for (const r of await db.emailSend.findMany({ where: { shopId, deviceId: { in: devices } }, select: { id: true } })) sendIds.add(r.id);
  if (sendIds.size) c.emailSends = (await db.emailSend.deleteMany({ where: { shopId, id: { in: [...sendIds] } } })).count;

  // 4. order checks: the buyer's own orders (listed by Shopify, or the same phone / name+address hash) are deleted;
  //    in every other check the buyer's values inside the matches are replaced.
  const checkIds = new Set<string>();
  if (t.orderGids.length) for (const r of await db.orderCheck.findMany({ where: { shopId, orderId: { in: t.orderGids } }, select: { id: true } })) checkIds.add(r.id);
  if (t.hashes.length) for (const r of await db.orderCheck.findMany({ where: { shopId, personHashes: { hasSome: t.hashes } }, select: { id: true } })) checkIds.add(r.id);
  if (checkIds.size) c.orderChecksDeleted = (await db.orderCheck.deleteMany({ where: { shopId, id: { in: [...checkIds] } } })).count;
  for await (const rows of pages(db.orderCheck, { shopId }, { matched: true, networkReasons: true })) {
    for (const r of rows) {
      const m = scrubJson(r.matched, t, country), n = scrubJson(r.networkReasons, t, country);
      if (m.changed || n.changed) { await db.orderCheck.update({ where: { id: r.id }, data: { ...(m.changed ? { matched: m.value } : {}), ...(n.changed ? { networkReasons: n.value } : {}) } }); c.orderChecksScrubbed++; }
    }
  }
  if (t.orderGids.length) c.deviceEvents = (await db.deviceEvent.deleteMany({ where: { shopId, orderId: { in: t.orderGids } } })).count;

  // 5. activity log: the buyer's values in any other line (added / removed data, Shopify requests) are replaced.
  for await (const rows of pages(db.auditLog, { shopId }, { payload: true })) {
    for (const r of rows) {
      if (r.payload == null) continue;
      const p = scrubJson(r.payload, t, country);
      if (p.changed) { await db.auditLog.update({ where: { id: r.id }, data: { payload: p.value } }); c.auditScrubbed++; }
    }
  }
  return c;
}
