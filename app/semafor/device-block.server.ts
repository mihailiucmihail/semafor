// Live device link for checkout blocking.
//
// The payment Function can only compare what the buyer typed (e-mail, phone, address, name) and the cart's
// `_dev` attribute with the blocklist. A blacklisted buyer who reloads the page and types another e-mail would
// get through. So, on every checkout step the pixel reports:
//   1. if anything the buyer typed — or the browser itself — matches a blacklist entry,
//   2. the browser (device id) and every new e-mail / phone / address typed from it are added to THAT entry,
//   3. and the blocklist is pushed to Shopify again, so the next payment check hides every method.
// Basic plan and up (checkout blocking + device links). Never throws.
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { SECRET } from "./shop.server";
import { buildIdentifiers, pushCheckoutMetafield, shareAddedIfShared } from "./entries.server";
import { planOf } from "./plan.server";
import { can } from "../../core/plans";
import { hmacId } from "../../core/hash";
import { normDevice, NORM_VERSION, type IdKind } from "../../core/normalize";

/** Kinds the payment Function can check, besides the device. Names alone are too common to add automatically. */
const LINK_KINDS: IdKind[] = ["email", "phone", "address"];
const pushing = new Map<string, Promise<unknown>>();

export async function linkDeviceAttempt(
  shop: { id: string; domain: string; plan: string | null; country: string },
  deviceId: string,
  typed: { email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null; address1?: string | null; city?: string | null; country?: string | null },
) {
  try {
    if (!can(planOf(shop), "checkout_block") || !can(planOf(shop), "device_links")) return;
    const dev = normDevice(deviceId);
    const ids = buildIdentifiers({
      email: typed.email ?? undefined, phone: typed.phone ?? undefined, firstName: typed.firstName ?? undefined, lastName: typed.lastName ?? undefined,
      address1: typed.address1 ?? undefined, city: typed.city ?? undefined, reason: "other",
    }, typed.country || shop.country)
      .filter((i) => LINK_KINDS.includes(i.kind) || i.kind === "name_address")
      .map((i) => ({ ...i, hash: hmacId(SECRET, i.kind, i.normalized) }));
    const all = dev ? [...ids, { kind: "device" as IdKind, raw: deviceId, normalized: dev, hash: hmacId(SECRET, "device", dev) }] : ids;
    if (!all.length) return;

    // which blacklist entry does this buyer / browser belong to? (the oldest one wins)
    const hit = await db.identifier.findFirst({
      where: { shopId: shop.id, hash: { in: all.map((i) => i.hash) }, entry: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
      orderBy: { entry: { createdAt: "asc" } },
      select: { entryId: true },
    });
    if (!hit) return;

    const have = new Set((await db.identifier.findMany({ where: { entryId: hit.entryId }, select: { hash: true } })).map((r) => r.hash));
    const add = all.filter((i) => (LINK_KINDS.includes(i.kind) || i.kind === "device") && !have.has(i.hash));
    if (!add.length) return;
    await db.identifier.createMany({
      data: add.map((i) => ({ entryId: hit.entryId, shopId: shop.id, kind: i.kind, raw: i.raw, normalized: i.normalized, hash: i.hash, normVersion: NORM_VERSION })),
    });
    await db.auditLog.create({
      data: { shopId: shop.id, actor: "semafor:device", action: "entry.link_device", entryId: hit.entryId, payload: { added: add.map((i) => ({ kind: i.kind, raw: i.raw })) } as any },
    }).catch(() => {});
    await shareAddedIfShared(hit.entryId, add).catch(() => {});

    // push the new blocklist to Shopify (one push at a time per shop; a push already running is awaited first)
    const prev = pushing.get(shop.id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      const { admin } = await unauthenticated.admin(shop.domain);
      await pushCheckoutMetafield(admin as any, shop.id);
    });
    pushing.set(shop.id, next);
    await next;
  } catch (e) {
    console.error("[semafor] linkDeviceAttempt", e);
  }
}

/**
 * One-off catch-up for a shop: browsers that typed a blacklisted e-mail / phone / address BEFORE live linking existed.
 * Each such browser is added to the entry it matched, plus the e-mails / phones / addresses typed from it after the
 * customer was put on the list (the same rule as the live link). Then the blocklist is pushed once.
 */
export async function backfillDeviceLinks(shop: { id: string; domain: string; plan: string | null; country: string }, admin: { graphql: (q: string, o?: any) => Promise<Response> }) {
  if (!can(planOf(shop), "checkout_block") || !can(planOf(shop), "device_links")) return 0;
  const attempts = (await db.checkoutAttempt.findMany({
    where: { shopId: shop.id, event: { not: "cart" }, createdAt: { gt: new Date(Date.now() - 120 * 86_400_000) } },
    orderBy: { createdAt: "asc" }, take: 20000,
    select: { deviceId: true, email: true, phone: true, firstName: true, lastName: true, address1: true, city: true, country: true, createdAt: true },
  })) as any[];
  const per = attempts.map((a) => buildIdentifiers({
    email: a.email ?? undefined, phone: a.phone ?? undefined, firstName: a.firstName ?? undefined, lastName: a.lastName ?? undefined,
    address1: a.address1 ?? undefined, city: a.city ?? undefined, reason: "other",
  }, a.country || shop.country).filter((i) => LINK_KINDS.includes(i.kind) || i.kind === "name_address").map((i) => ({ ...i, hash: hmacId(SECRET, i.kind, i.normalized) })));
  const hashes = [...new Set(per.flat().map((i) => i.hash))];
  if (!hashes.length) return 0;
  const hits = (await db.identifier.findMany({
    where: { shopId: shop.id, hash: { in: hashes }, entry: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
    select: { hash: true, entryId: true, entry: { select: { createdAt: true } } },
  })) as any[];
  const entryOf = new Map<string, { id: string; at: number }>();
  for (const h of hits) { const cur = entryOf.get(h.hash); const at = +new Date(h.entry.createdAt); if (!cur || at < cur.at) entryOf.set(h.hash, { id: h.entryId, at }); }

  // device → entry it belongs to (first match), and when it was first seen typing blacklisted data
  const devEntry = new Map<string, { id: string; at: number }>();
  attempts.forEach((a, k) => {
    for (const i of per[k]) { const e = entryOf.get(i.hash); if (e && !devEntry.has(a.deviceId)) devEntry.set(a.deviceId, e); }
  });
  if (!devEntry.size) return 0;

  const add = new Map<string, Array<{ kind: IdKind; raw: string; normalized: string; hash: string }>>();
  const push = (entryId: string, x: { kind: IdKind; raw: string; normalized: string; hash: string }) => { const l = add.get(entryId) ?? []; if (!l.some((y) => y.hash === x.hash)) l.push(x); add.set(entryId, l); };
  for (const [dev, e] of devEntry) {
    const n = normDevice(dev);
    if (n) push(e.id, { kind: "device", raw: dev, normalized: n, hash: hmacId(SECRET, "device", n) });
  }
  attempts.forEach((a, k) => {
    const e = devEntry.get(a.deviceId);
    if (!e || +a.createdAt < e.at) return; // only what was typed after the customer was on the list
    for (const i of per[k]) if (LINK_KINDS.includes(i.kind)) push(e.id, i);
  });

  let total = 0;
  for (const [entryId, list] of add) {
    const have = new Set((await db.identifier.findMany({ where: { entryId }, select: { hash: true } })).map((r) => r.hash));
    const fresh = list.filter((x) => !have.has(x.hash));
    if (!fresh.length) continue;
    await db.identifier.createMany({ data: fresh.map((x) => ({ entryId, shopId: shop.id, kind: x.kind, raw: x.raw, normalized: x.normalized, hash: x.hash, normVersion: NORM_VERSION })) });
    await db.auditLog.create({ data: { shopId: shop.id, actor: "semafor:device", action: "entry.link_device", entryId, payload: { added: fresh.map((x) => ({ kind: x.kind, raw: x.raw })) } as any } }).catch(() => {});
    await shareAddedIfShared(entryId, fresh).catch(() => {});
    total += fresh.length;
  }
  if (total) await pushCheckoutMetafield(admin as any, shop.id);
  return total;
}
