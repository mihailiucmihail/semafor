// Who from the blacklist tried to check out (shared by the "Blocked attempts" page and the overview).
import db from "../db.server";
import { SECRET } from "./shop.server";
import { buildIdentifiers, nameOnlyEntries, nameOnlyHit } from "./entries.server";
import { hmacId } from "../../core/hash";

/** One person (browser) from the blacklist who reached checkout in the period, newest first (max 300). */
export async function blockedPeople(shop: { id: string; country: string }, since: Date) {
  const attempts = (await db.checkoutAttempt.findMany({
    where: { shopId: shop.id, createdAt: { gt: since }, event: { not: "cart" } },
    orderBy: { createdAt: "asc" }, take: 20000,
  })) as any[];

  const KINDS = ["email", "phone", "name_address", "address"];
  const per = attempts.map((a) => buildIdentifiers({ email: a.email ?? undefined, phone: a.phone ?? undefined, firstName: a.firstName ?? undefined, lastName: a.lastName ?? undefined, address1: a.address1 ?? undefined, city: a.city ?? undefined, reason: "other" }, shop.country)
    .filter((i) => KINDS.includes(i.kind)).map((i) => ({ ...i, hash: hmacId(SECRET, i.kind, i.normalized) })));
  const hashes = [...new Set(per.flat().map((i) => i.hash))];
  const hits = hashes.length ? ((await db.identifier.findMany({ where: { shopId: shop.id, hash: { in: hashes } }, select: { hash: true, entry: { select: { reason: true, createdAt: true } } } })) as any[]) : [];
  // a try only counts if the customer was ALREADY on the list at that moment (added later = not a blocked try)
  const hitMap = new Map<string, { reason: string; at: number }>();
  for (const h of hits) { const at = +new Date(h.entry.createdAt); const prev = hitMap.get(h.hash); if (!prev || at < prev.at) hitMap.set(h.hash, { reason: h.entry.reason, at }); }
  const nameOnly = await nameOnlyEntries(shop.id);

  type Row = { dev: string; first: Date; last: Date; names: Set<string>; emails: Set<string>; phones: Set<string>; city: string | null;
    matched: Map<string, string>; reasons: Set<string>; tries: number; total: number | null; currency: string | null; items: any[]; completed: boolean; orderId: string | null };
  const devs = new Map<string, Row>();
  attempts.forEach((a, k) => {
    const m = new Map<string, string>();
    const reasons = new Set<string>();
    for (const i of per[k]) { const h = hitMap.get(i.hash); if (h && h.at <= +a.createdAt) { m.set(i.raw, i.kind === "name_address" ? "name" : i.kind); reasons.add(h.reason); } }
    const nm = nameOnly.length ? nameOnlyHit(nameOnly, a.firstName, a.lastName, a.createdAt) : null;
    if (nm) m.set([a.firstName, a.lastName].filter(Boolean).join(" "), "name");
    const known = devs.get(a.deviceId);
    if (!m.size && !known) return;
    const r: Row = known ?? { dev: a.deviceId, first: a.createdAt, last: a.createdAt, names: new Set(), emails: new Set(), phones: new Set(), city: null, matched: new Map(), reasons: new Set(), tries: 0, total: null, currency: null, items: [], completed: false, orderId: null };
    r.last = a.createdAt; r.tries++;
    for (const [x, kind] of m) r.matched.set(x, kind);
    for (const x of reasons) r.reasons.add(x);
    const n = [a.firstName, a.lastName].filter(Boolean).join(" "); if (n) r.names.add(n);
    if (a.email) r.emails.add(a.email); if (a.phone) r.phones.add(a.phone); if (a.city) r.city = a.city;
    if (a.total != null) { r.total = Number(a.total); r.currency = a.currency; }
    if (Array.isArray(a.items) && a.items.length) r.items = a.items;
    if (a.event === "completed") r.completed = true;
    if (a.orderId) r.orderId = a.orderId;
    devs.set(a.deviceId, r);
  });

  const list = [...devs.values()].filter((r) => r.matched.size).sort((a, b) => +b.last - +a.last).slice(0, 300);
  return list;
}

/** Overview numbers: people stopped and people who got through anyway. */
export async function blockedSummary(shop: { id: string; country: string }, since: Date) {
  const list = await blockedPeople(shop, since);
  const through = list.filter((r) => r.completed).length;
  return { people: list.length, through, stopped: list.length - through };
}
