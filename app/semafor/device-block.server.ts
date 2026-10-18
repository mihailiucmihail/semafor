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
import { buildIdentifiers, pushCheckoutMetafield } from "./entries.server";
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
