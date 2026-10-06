// Block entries: create / delete, network sharing rule, checkout metafield rebuild.
import { createHash } from "node:crypto";
import db from "../db.server";
import { SECRET } from "./shop.server";
import { hmacId, shopRef } from "../../core/hash";
import { normEmail, normPhone, normName, normAddress, normNameAddress, normDevice, NORM_VERSION, type IdKind } from "../../core/normalize";
import { shouldShareToNetwork, type ShopSettings } from "../../core/settings";

import { type Reason } from "../../core/reasons";
export type { Reason };

export interface EntryInput {
  email?: string; phone?: string; firstName?: string; lastName?: string;
  address1?: string; address2?: string; city?: string;
  device?: string;
  reason: Reason; note?: string;
  source?: "manual" | "order" | "import" | "courier";
  orderId?: string; orderName?: string;
}

interface Ident { kind: IdKind; raw: string; normalized: string }

export function buildIdentifiers(i: EntryInput, country = "RO"): Ident[] {
  const out: Ident[] = [];
  const add = (kind: IdKind, raw: string | undefined, normalized: string | null) => {
    if (raw && normalized) out.push({ kind, raw: raw.trim(), normalized });
  };
  add("email", i.email, i.email ? normEmail(i.email) : null);
  add("phone", i.phone, i.phone ? normPhone(i.phone, country) : null);
  const name = normName(i.firstName, i.lastName);
  const rawName = [i.firstName, i.lastName].filter(Boolean).join(" ");
  add("name", rawName || undefined, name);
  const addr = normAddress({ address1: i.address1, address2: i.address2, city: i.city });
  const rawAddr = [i.address1, i.address2, i.city].filter(Boolean).join(", ");
  add("address", rawAddr || undefined, addr);
  add("name_address", rawName && rawAddr ? `${rawName} / ${rawAddr}` : undefined, normNameAddress(name, addr));
  add("device", i.device, i.device ? normDevice(i.device) : null);
  return out;
}

export async function createEntry(opts: { shopId: string; shopDomain: string; country: string; settings: ShopSettings; input: EntryInput; actor: string }) {
  const { shopId, input } = opts;
  const ids = buildIdentifiers(input, opts.country);
  if (!ids.length) throw new Error("Nu există niciun identificator valid (e-mail, telefon, nume + adresă).");

  // "со второго раза": count earlier refuz_colet entries of this shop sharing any identifier
  const hashes = ids.map((x) => hmacId(SECRET, x.kind, x.normalized));
  const prior = await db.identifier.findMany({
    where: { shopId, hash: { in: hashes }, entry: { reason: "refuz_colet" } },
    select: { entryId: true },
  });
  const priorRefuz = new Set((prior as any[]).map((p) => p.entryId)).size;
  const share = shouldShareToNetwork(opts.settings, input.reason, priorRefuz);

  const entry = await db.blockEntry.create({
    data: {
      shopId, reason: input.reason, note: input.note || null, source: input.source ?? "manual",
      orderId: input.orderId || null, orderName: input.orderName || null, createdBy: opts.actor, shared: share,
      identifiers: { create: ids.map((x, k) => ({ shopId, kind: x.kind, raw: x.raw, normalized: x.normalized, hash: hashes[k], normVersion: NORM_VERSION })) },
    },
    include: { identifiers: true },
  });

  if (share) {
    const ref = shopRef(SECRET, opts.shopDomain);
    const expiresAt = new Date(Date.now() + 730 * 86400e3);
    const strong = (entry.identifiers as any[]).filter((x) => ["email", "phone", "name_address"].includes(x.kind));
    for (const x of strong) {
      await db.networkReport.upsert({
        where: { hash_shopRef: { hash: x.hash, shopRef: ref } },
        create: { hash: x.hash, kind: x.kind, reason: input.reason, country: opts.country, shopRef: ref, expiresAt },
        update: { reason: input.reason, expiresAt },
      });
    }
  }
  await db.auditLog.create({ data: { shopId, actor: opts.actor, action: "entry.create", entryId: entry.id, payload: { reason: input.reason, kinds: ids.map((x) => x.kind), shared: share } } });
  return entry;
}

export async function deleteEntry(shopId: string, shopDomain: string, entryId: string, actor: string) {
  const entry = await db.blockEntry.findFirst({ where: { id: entryId, shopId }, include: { identifiers: true } });
  if (!entry) return;
  if (entry.shared) {
    const ref = shopRef(SECRET, shopDomain);
    await db.networkReport.deleteMany({ where: { shopRef: ref, hash: { in: (entry.identifiers as any[]).map((x) => x.hash) } } });
  }
  await db.blockEntry.delete({ where: { id: entryId } });
  await db.auditLog.create({ data: { shopId, actor, action: "entry.delete", entryId, payload: { reason: entry.reason } } });
}

/**
 * Checkout metafield: short plain-SHA256 hashes per kind (the Function cannot keep the HMAC secret).
 * {"v":1,"e":[...],"p":[...],"a":[...],"d":[...],"msg":"..."}
 */
export async function buildCheckoutPayload(shopId: string, msg?: string) {
  const rows = await db.identifier.findMany({
    where: { shopId, kind: { in: ["email", "phone", "address", "device"] }, entry: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
    select: { kind: true, normalized: true },
  });
  const sh = (kind: string, n: string) => createHash("sha256").update(`${kind}:${n}`).digest("hex").slice(0, 16);
  const buckets: Record<string, Set<string>> = { e: new Set(), p: new Set(), a: new Set(), d: new Set() };
  const key: Record<string, string> = { email: "e", phone: "p", address: "a", device: "d" };
  for (const r of rows) buckets[key[r.kind]].add(sh(r.kind, r.normalized));
  return { v: 1, e: [...buckets.e], p: [...buckets.p], a: [...buckets.a], d: [...buckets.d], msg: msg || "Nu putem finaliza această comandă. Vă rugăm să ne contactați." };
}

export async function pushCheckoutMetafield(admin: { graphql: (q: string, o?: any) => Promise<Response> }, shopId: string) {
  const payload = await buildCheckoutPayload(shopId);
  const idRes = await admin.graphql(`#graphql
    query { shop { id } }`);
  const shopGid = (await idRes.json()).data.shop.id;
  const res = await admin.graphql(`#graphql
    mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ field message } } }`,
    { variables: { m: [{ ownerId: shopGid, namespace: "semafor", key: "blocklist", type: "json", value: JSON.stringify(payload) }] } });
  const j = await res.json();
  if (j.data?.metafieldsSet?.userErrors?.length) console.error("metafieldsSet", j.data.metafieldsSet.userErrors);
  return payload;
}
