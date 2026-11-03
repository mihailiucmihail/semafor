import type { PrismaClient } from "@prisma/client";
import { buildIdentifiers } from "./entries.server";
import { hmacId } from "../../core/hash";
import { normEmail, normPhone, normName } from "../../core/normalize";

export type DeviceFinding = { kind: "device"; normalized: string; entryId: string; reason: string; weight: number };

const DAY = 86_400_000;
const orderNum = (id: string) => String(id).split("/").pop() || "";

/**
 * Looks at every checkout attempt made from the same device as this order (same browser id,
 * or same device fingerprint on the same IP) during the last 30 days.
 *  - if any identity tried from that device is on the blacklist → red (weight 100)
 *  - if the device cycled through several identities within 48 h → yellow (weight 40)
 */
export type Buyer = { email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null };
type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

/** Checkout tokens used by more than one browser: token → the browser that created it (first step). */
async function sharedTokens(db: PrismaClient, shopId: string, tokens: string[]) {
  const out = new Map<string, string>();
  if (!tokens.length) return out;
  const rows = (await db.checkoutAttempt.findMany({ where: { shopId, checkoutToken: { in: tokens } }, orderBy: { createdAt: "asc" }, select: { checkoutToken: true, deviceId: true } })) as any[];
  const first = new Map<string, string>(), devs = new Map<string, Set<string>>();
  for (const r of rows) { if (!first.has(r.checkoutToken)) first.set(r.checkoutToken, r.deviceId); const s = devs.get(r.checkoutToken) ?? new Set<string>(); s.add(r.deviceId); devs.set(r.checkoutToken, s); }
  for (const [t, s] of devs) if (s.size > 1) out.set(t, first.get(t)!);
  return out;
}

export async function deviceLinks(db: PrismaClient, secret: string, shopId: string, checkoutToken: string | null | undefined, country = "RO", ro = true, orderId?: string, buyer?: Buyer, admin?: Admin) {
  if (!checkoutToken) return { findings: [] as DeviceFinding[], identities: [] as string[] };
  let seed = await db.checkoutAttempt.findMany({ where: { shopId, checkoutToken }, orderBy: { createdAt: "asc" }, select: { deviceId: true, fingerprint: true, ip: true, event: true } }) as any[];
  if (!seed.length) return { findings: [], identities: [] };
  // a checkout opened in several browsers (a link shared or sent by e-mail): only the browser that placed the order
  // (or, failing that, the one that created the checkout) counts — the others only looked at someone else's checkout
  if (new Set(seed.map((s: any) => s.deviceId)).size > 1) {
    const placer = seed.filter((s: any) => s.event === "completed").map((s: any) => s.deviceId);
    const keep = new Set<string>(placer.length ? placer : [seed[0].deviceId]);
    seed = seed.filter((s: any) => keep.has(s.deviceId));
  }

  const devices = [...new Set(seed.map((s: any) => s.deviceId as string))];
  const fpIp = seed.filter((s: any) => s.fingerprint && s.ip).map((s: any) => ({ fingerprint: s.fingerprint!, ip: s.ip! }));
  const since = new Date(Date.now() - 30 * DAY);
  const attempts0 = await db.checkoutAttempt.findMany({
    where: { shopId, createdAt: { gt: since }, OR: [{ deviceId: { in: devices } }, ...fpIp.map((x: any) => ({ fingerprint: x.fingerprint, ip: x.ip }))] },
    orderBy: { createdAt: "asc" },
  }) as any[];
  // drop steps a browser made inside a checkout another browser created (someone else's data, prefilled)
  {
    const shared = await sharedTokens(db, shopId, [...new Set(attempts0.map((a: any) => a.checkoutToken).filter(Boolean))] as string[]);
    attempts0.splice(0, attempts0.length, ...attempts0.filter((a: any) => !a.checkoutToken || !shared.has(a.checkoutToken) || shared.get(a.checkoutToken) === a.deviceId));
  }
  const attempts = attempts0;

  // distinct identities used from this device
  const emails = new Map<string, string>(), phones = new Map<string, string>(), names = new Map<string, string>();
  for (const a of attempts) {
    const e = a.email && normEmail(a.email); if (e) emails.set(e, a.email!);
    const p = a.phone && normPhone(a.phone, country); if (p) phones.set(p, a.phone!);
    const n = normName(a.firstName, a.lastName); if (n) names.set(n, [a.firstName, a.lastName].filter(Boolean).join(" "));
  }
  const identities = [...emails.values(), ...phones.values(), ...names.values()];
  const findings: DeviceFinding[] = [];

  // blacklisted identity tried from this device
  const seen = new Set<string>();
  for (const a of attempts) {
    const ids = buildIdentifiers({ email: a.email ?? undefined, phone: a.phone ?? undefined, firstName: a.firstName ?? undefined, lastName: a.lastName ?? undefined, address1: a.address1 ?? undefined, city: a.city ?? undefined, reason: "other" }, country)
      .filter((i) => i.kind === "email" || i.kind === "phone" || i.kind === "name_address" || i.kind === "address");
    for (const i of ids) {
      const key = `${i.kind}:${i.normalized}`; if (seen.has(key)) continue; seen.add(key);
      const row = await db.identifier.findFirst({ where: { shopId, kind: i.kind as any, hash: hmacId(secret, i.kind, i.normalized) }, include: { entry: { select: { id: true, reason: true, expiresAt: true } } } }) as any;
      if (!row || (row.entry.expiresAt && row.entry.expiresAt < new Date())) continue;
      const strong = i.kind !== "address";
      findings.push({ kind: "device", normalized: ro ? `dispozitivul a încercat ${i.raw}` : `this device tried ${i.raw}`, entryId: row.entry.id, reason: row.entry.reason, weight: strong ? 100 : 60 });
    }
  }

  // identity hopping within 48 h
  const recent = attempts.filter((a) => a.createdAt.getTime() > Date.now() - 2 * DAY);
  const rE = new Set(recent.map((a) => a.email && normEmail(a.email)).filter(Boolean));
  const rP = new Set(recent.map((a) => a.phone && normPhone(a.phone, country)).filter(Boolean));
  const rN = new Set(recent.map((a) => normName(a.firstName, a.lastName)).filter(Boolean));
  if (rE.size >= 3 || rP.size >= 3 || rN.size >= 3 || rE.size + rP.size + rN.size >= 6) {
    findings.push({ kind: "device", normalized: ro ? `${rE.size} e-mailuri, ${rP.size} telefoane, ${rN.size} nume în 48 h de pe același dispozitiv` : `${rE.size} e-mails, ${rP.size} phones, ${rN.size} names in 48 h from the same device`, entryId: "", reason: ro ? "schimbă datele" : "changes identity", weight: 40 });
  }
  // other orders placed from the same browser (90 days). Not a warning when they were placed by this same buyer
  // (a returning customer), nor when they were placed under another name but all ended well (paid and shipped/delivered).
  // Only orders under another name that were cancelled, refused, unpaid or are still open keep the light yellow.
  const devOrders = (await db.checkoutAttempt.findMany({
    where: { shopId, deviceId: { in: devices }, orderId: { not: null }, createdAt: { gt: new Date(Date.now() - 90 * DAY) } },
    orderBy: { createdAt: "desc" }, select: { orderId: true, firstName: true, lastName: true, email: true, phone: true, checkoutToken: true, deviceId: true },
  })) as any[];
  const sharedO = await sharedTokens(db, shopId, [...new Set(devOrders.map((a) => a.checkoutToken).filter(Boolean))] as string[]);
  const myE = buyer?.email ? normEmail(buyer.email) : null, myP = buyer?.phone ? normPhone(buyer.phone, country) : null, myN = normName(buyer?.firstName, buyer?.lastName);
  const samePerson = (a: any) => !!((myE && a.email && normEmail(a.email) === myE) || (myP && a.phone && normPhone(a.phone, country) === myP) || (myN && normName(a.firstName, a.lastName) === myN));
  // the pixel reports gid://shopify/OrderIdentity/N, the webhook gid://shopify/Order/N — compare by the number,
  // and never list the order being checked itself
  const self = orderId ? orderNum(orderId) : "";
  const byOrder = new Map<string, string>(), mine = new Set<string>();
  for (const a of devOrders) {
    if (a.checkoutToken && sharedO.has(a.checkoutToken) && sharedO.get(a.checkoutToken) !== a.deviceId) continue;
    const num = a.orderId ? orderNum(a.orderId) : ""; if (!num || num === self) continue;
    const gid = `gid://shopify/Order/${num}`;
    if (samePerson(a)) { mine.add(gid); continue; }
    if (!byOrder.has(gid)) byOrder.set(gid, [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email || "");
  }
  for (const g of mine) byOrder.delete(g); // any step of that order by this buyer → it is hers
  if (byOrder.size && admin) {
    try {
      const ids = [...byOrder.keys()].slice(0, 20);
      const d: any = await (await admin.graphql(`#graphql
        query($ids:[ID!]!){ nodes(ids:$ids){ ... on Order { id cancelledAt displayFinancialStatus displayFulfillmentStatus fulfillments(first:5){ displayStatus } } } }`, { variables: { ids } })).json();
      for (const o of (d?.data?.nodes ?? []) as any[]) {
        if (!o?.id) continue;
        const shipped = o.displayFulfillmentStatus === "FULFILLED" || (o.fulfillments || []).some((f: any) => f.displayStatus === "DELIVERED");
        const refused = (o.fulfillments || []).some((f: any) => ["FAILURE", "CANCELED", "NOT_DELIVERED"].includes(f.displayStatus));
        if (!o.cancelledAt && o.displayFinancialStatus === "PAID" && shipped && !refused) byOrder.delete(o.id);
      }
    } catch (e) { console.error("[semafor] device orders status", e); }
  }
  if (byOrder.size) {
    const names = (await db.orderCheck.findMany({ where: { shopId, orderId: { in: [...byOrder.keys()] } }, select: { orderId: true, orderName: true } })) as any[];
    const nameOf = new Map(names.map((n) => [n.orderId, n.orderName]));
    const list = [...byOrder].slice(0, 5).map(([id, who]) => `${nameOf.get(id) || "#" + String(id).split("/").pop()}${who ? ` (${who})` : ""}`).join(", ");
    // stored in Romanian (canonical); app/i18n.ts translates it for the admin language
    findings.push({ kind: "device", normalized: `de pe același dispozitiv mai există comenzile: ${list}`, entryId: "", reason: "același dispozitiv", weight: 40 });
  }
  return { findings, identities };
}
