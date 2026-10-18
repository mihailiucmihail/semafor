// Block entries: create / delete, network sharing rule, checkout metafield rebuild.
import { can } from "../../core/plans";
import { planOf } from "./plan.server";
import { createHash } from "node:crypto";
import db from "../db.server";
import { SECRET } from "./shop.server";
import { hmacId, shopRef } from "../../core/hash";
import { normEmail, normPhone, normName, normAddress, normNameAddress, normDevice, NORM_VERSION, type IdKind } from "../../core/normalize";
import { shouldShareToNetwork, settingsOf, networkOf, payActions, type ShopSettings } from "../../core/settings";

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

export function buildIdentifiers(i: EntryInput, country = "RO", opts?: { keepWeakAddress?: boolean }): Ident[] {
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
  // An address without a house number ("Strada Lungă", a village) is too weak to block on, but the merchant typed it
  // and must see it on the customer: when saving an entry (keepWeakAddress) it is kept under a display-only key ("~…").
  // Lookups never build that key, so it never matches; it never reaches the checkout blocklist or the network either.
  add("address", rawAddr || undefined, addr ?? (rawAddr && opts?.keepWeakAddress ? weakAddressKey(rawAddr) : null));
  add("name_address", rawName && rawAddr ? `${rawName} / ${rawAddr}` : undefined, normNameAddress(name, addr));
  add("device", i.device, i.device ? normDevice(i.device) : null);
  return out;
}

/** Strong identifiers (e-mail, phone, name + address) of a shared entry → the network (24 months). */
export async function shareToNetwork(shopDomain: string, country: string, reason: string, ids: Array<{ kind: string; hash: string; normalized?: string }>) {
  const ref = shopRef(SECRET, shopDomain);
  const expiresAt = new Date(Date.now() + 730 * 86400e3);
  for (const x of ids.filter((i) => ["email", "phone", "name_address"].includes(i.kind))) {
    const fnHash = (x.kind === "email" || x.kind === "phone") && x.normalized ? fnHashOf(x.kind, x.normalized) : null;
    await db.networkReport.upsert({
      where: { hash_shopRef: { hash: x.hash, shopRef: ref } },
      create: { hash: x.hash, kind: x.kind as IdKind, reason: reason as any, country, shopRef: ref, expiresAt, fnHash },
      update: { reason: reason as any, expiresAt, ...(fnHash ? { fnHash } : {}) },
    });
  }
}

/** The short hash the checkout Function compares (see extensions/semafor-hide-payment). */
export const fnHashOf = (kind: string, normalized: string) => createHash("sha256").update(`${kind}:${normalized}`).digest("hex").slice(0, 16);

/** Older network reports (before fnHash existed): fill it from any identifier with the same HMAC. Cheap when nothing is missing. */
export async function fillNetworkFnHash() {
  const rows = await db.networkReport.findMany({ where: { fnHash: null, kind: { in: ["email", "phone"] } }, select: { id: true, hash: true, kind: true }, take: 2000 });
  if (!rows.length) return 0;
  const ids = await db.identifier.findMany({ where: { hash: { in: [...new Set(rows.map((r) => r.hash))] } }, select: { hash: true, kind: true, normalized: true }, distinct: ["hash"] });
  const byHash = new Map(ids.map((i) => [i.hash, fnHashOf(i.kind, i.normalized)]));
  let n = 0;
  for (const r of rows) { const f = byHash.get(r.hash); if (f) { await db.networkReport.update({ where: { id: r.id }, data: { fnHash: f } }); n++; } }
  return n;
}

/** Takes this shop's network reports of some identifiers back (e.g. data removed from an entry). */
export async function unshareFromNetwork(shopDomain: string, hashes: string[]) {
  if (!hashes.length) return;
  await db.networkReport.deleteMany({ where: { shopRef: shopRef(SECRET, shopDomain), hash: { in: hashes } } });
}

/** New identifiers on an entry that is already in the network go to the network too. */
export async function shareAddedIfShared(entryId: string, ids: Array<{ kind: string; hash: string; normalized?: string }>) {
  const e = await db.blockEntry.findUnique({ where: { id: entryId }, select: { shared: true, reason: true, shop: { select: { domain: true, country: true } } } });
  if (e?.shared) await shareToNetwork(e.shop.domain, e.shop.country, e.reason, ids);
}

/** Display-only key of an address that normAddress cannot use for matching. */
export const weakAddressKey = (raw: string) => "~" + raw.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
export const isWeakAddress = (normalized: string) => normalized.startsWith("~");

/** Adds e-mails / phones / names / addresses to an existing entry (skips what it already holds). Returns how many were added. */
export async function addToEntry(shopId: string, entryId: string, input: Omit<EntryInput, "reason">, country: string, actor: string) {
  const ids = buildIdentifiers({ ...input, reason: "other" }, country, { keepWeakAddress: true });
  const have = new Set((await db.identifier.findMany({ where: { entryId }, select: { hash: true } })).map((r) => r.hash));
  const add = ids.map((x) => ({ ...x, hash: hmacId(SECRET, x.kind, x.normalized) })).filter((x) => !have.has(x.hash));
  if (!add.length) return 0;
  await db.identifier.createMany({ data: add.map((x) => ({ entryId, shopId, kind: x.kind, raw: x.raw, normalized: x.normalized, hash: x.hash, normVersion: NORM_VERSION })) });
  await db.auditLog.create({ data: { shopId, actor, action: "entry.add_data", entryId, payload: { added: add.map((x) => ({ kind: x.kind, raw: x.raw })) } as any } });
  await shareAddedIfShared(entryId, add);
  return add.length;
}

/** Kinds strong enough to say "this is the same customer" (a name or an address alone is not). */
const SAME_PERSON_KINDS = new Set(["email", "phone", "name_address"]);

export interface ExistingMatch {
  entryId: string; reason: string; createdAt: Date; orderId: string | null; orderName: string | null;
  source: string; sameOrder: boolean;
  matched: { kind: string; raw: string }[];
}

/**
 * Entries of this shop that already hold the same customer (same e-mail, phone or name + address),
 * newest first. Used to warn the merchant before adding a duplicate.
 */
export async function findExisting(shopId: string, input: Partial<EntryInput>, country = "RO"): Promise<ExistingMatch[]> {
  const ids = buildIdentifiers({ reason: "other", ...input } as EntryInput, country).filter((x) => SAME_PERSON_KINDS.has(x.kind));
  const hashes = ids.map((x) => hmacId(SECRET, x.kind, x.normalized));
  const or: any[] = [];
  if (hashes.length) or.push({ identifiers: { some: { hash: { in: hashes } } } });
  if (input.orderId) or.push({ orderId: input.orderId });
  if (!or.length) return [];
  const rows: any[] = await db.blockEntry.findMany({
    where: { shopId, OR: or },
    include: { identifiers: { select: { kind: true, raw: true, hash: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const want = new Set(hashes);
  return rows.map((e) => ({
    entryId: e.id, reason: e.reason, createdAt: e.createdAt, orderId: e.orderId, orderName: e.orderName, source: e.source,
    sameOrder: !!input.orderId && e.orderId === input.orderId,
    matched: (e.identifiers as any[]).filter((x) => want.has(x.hash)).map((x) => ({ kind: x.kind, raw: x.raw })),
  }));
}

export async function createEntry(opts: { shopId: string; shopDomain: string; country: string; settings: ShopSettings; input: EntryInput; actor: string }) {
  const { shopId, input } = opts;
  const ids = buildIdentifiers(input, opts.country, { keepWeakAddress: true });
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

  if (share) await shareToNetwork(opts.shopDomain, opts.country, input.reason, entry.identifiers as any[]);
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
/** Name-only entries (no e-mail, phone, address or device): normalized name + when it was added to the list. */
export async function nameOnlyEntries(shopId: string): Promise<{ name: string; at: Date }[]> {
  const rows = (await db.identifier.findMany({
    where: { shopId, kind: "name", entry: { identifiers: { every: { OR: [{ kind: "name" }, { kind: "address", normalized: { startsWith: "~" } }] } }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
    select: { normalized: true, entry: { select: { createdAt: true } } },
  })) as any[];
  return rows.filter((r) => r.normalized).map((r) => ({ name: String(r.normalized), at: new Date(r.entry.createdAt) }));
}
export async function nameOnlyRows(shopId: string): Promise<string[]> {
  return [...new Set((await nameOnlyEntries(shopId)).map((r) => r.name))];
}

/**
 * Does a buyer name hit one of the name-only entries? One word = that word anywhere in the name, several = full name.
 * With `when`, only entries that were already on the list at that moment count.
 */
export function nameOnlyHit(names: (string | { name: string; at: Date })[], first?: string | null, last?: string | null, when?: Date): string | null {
  const n = normName(first, last);
  if (!n) return null;
  const w = new Set(n.split(" "));
  for (const e of names) {
    const x = typeof e === "string" ? e : e.name;
    if (when && typeof e !== "string" && +e.at > +when) continue;
    if (x.includes(" ") ? x === n : w.has(x)) return x;
  }
  return null;
}

export async function buildCheckoutPayload(shopId: string, msg?: string) {
  const empty = { v: 1, e: [] as string[], p: [] as string[], a: [] as string[], d: [] as string[], msg: msg || "Nu putem finaliza această comandă. Vă rugăm să ne contactați." };
  // Blocking in checkout (hide cash on delivery / block) is a Basic feature.
  const shopRow = await db.shop.findUnique({ where: { id: shopId }, select: { plan: true, domain: true, settings: true, trialEndsAt: true } });
  if (!can(planOf(shopRow), "checkout_block")) return empty;
  const rows = await db.identifier.findMany({
    where: { shopId, kind: { in: ["email", "phone", "address", "device"] }, entry: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
    select: { kind: true, normalized: true },
  });
  const sh = (kind: string, n: string) => createHash("sha256").update(`${kind}:${n}`).digest("hex").slice(0, 16);
  const buckets: Record<string, Set<string>> = { e: new Set(), p: new Set(), a: new Set(), d: new Set(), n: new Set(), w: new Set() };
  const key: Record<string, string> = { email: "e", phone: "p", address: "a", device: "d" };
  for (const r of rows) if (!(r.kind === "address" && isWeakAddress(r.normalized))) buckets[key[r.kind]].add(sh(r.kind, r.normalized));
  // Name-only entries (the merchant blocked a person by name, with no e-mail/phone/address): match the delivery name.
  // One word ("picioruș") = that word anywhere in first/last name; several words = the full name (any order).
  // Names that are only part of a fuller entry are NOT used here — too many people share a name.
  // Full names go to `n`, single words to `w` (the Function then only hashes the buyer's name words when `w` has entries).
  for (const r of await nameOnlyRows(shopId)) { if (r.includes(" ")) buckets.n.add(sh("name", r)); else buckets.w.add(sh("nw", r)); }
  // Network blocking (optional, off by default): e-mails / phones reported by enough OTHER shops for a counted reason
  const st = settingsOf(shopRow?.settings);
  const nw = networkOf(st.network);
  const yb: Record<"e" | "p", Set<string>> = { e: new Set(), p: new Set() };
  if (st.shareNetwork && nw.block !== "off" && shopRow) {
    const min = nw.block === "red" ? nw.red : nw.yellow;
    const own = shopRef(SECRET, shopRow.domain);
    const reps = await db.networkReport.findMany({
      where: { fnHash: { not: null }, kind: { in: ["email", "phone"] }, reason: { in: nw.reasons as any }, expiresAt: { gt: new Date() }, shopRef: { not: own } },
      select: { fnHash: true, kind: true, shopRef: true }, orderBy: { createdAt: "desc" }, take: 20000,
    });
    const shops = new Map<string, { kind: string; refs: Set<string> }>();
    for (const r of reps) { const k = r.fnHash!; const cur = shops.get(k) ?? { kind: r.kind, refs: new Set<string>() }; cur.refs.add(r.shopRef); shops.set(k, cur); }
    let added = 0;
    for (const [h, v] of shops) {
      if (v.refs.size < min || added >= 1500) continue; // keep the Function input small
      // red in the network → red tier; flagged by fewer shops (only when the merchant includes yellow) → yellow tier
      if (v.refs.size >= nw.red) buckets[v.kind === "email" ? "e" : "p"].add(h);
      else yb[v.kind === "email" ? "e" : "p"].add(h);
      added++;
    }
  }
  // m: what the checkout does per level (all = no payment method, cod = no cash on delivery, none = nothing)
  const m = payActions(st);
  return { v: 2, e: [...buckets.e], p: [...buckets.p], a: [...buckets.a], d: [...buckets.d], n: [...buckets.n], w: [...buckets.w], y: { e: [...yb.e], p: [...yb.p] }, m, msg: msg || "Nu putem finaliza această comandă. Vă rugăm să ne contactați." };
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
  // same list on the payment customization (read by the hide-payment Function)
  try { await syncPaymentBlock(admin, payload); } catch (e) { console.error("[semafor] syncPaymentBlock", e); }
  return payload;
}

/**
 * Make sure the "Semafor — plăți" payment customization exists and carries the current blocklist.
 * Returns a status line for the Settings page.
 */
const PC_TITLE = "Semafor — blacklist payment rules";

export async function syncPaymentBlock(admin: { graphql: (q: string, o?: any) => Promise<Response> }, payload?: any) {
  const q: any = await (await admin.graphql(`#graphql
    query { paymentCustomizations(first: 25) { nodes { id title enabled functionId } }
            shopifyFunctions(first: 25, apiType: "payment_customization") { nodes { id handle app { title } } } }`)).json();
  if (q.errors) return { ok: false, error: q.errors.map((e: any) => e.message).join("; ") };
  const fn = q.data.shopifyFunctions.nodes.find((f: any) => f.handle === "semafor-hide-payment");
  if (!fn) return { ok: false, error: "payment function not deployed yet" };
  const value = JSON.stringify(payload ?? {});
  let pc = q.data.paymentCustomizations.nodes.find((n: any) => n.functionId === fn.id);
  if (!pc) {
    const r: any = await (await admin.graphql(`#graphql
      mutation($in: PaymentCustomizationInput!) { paymentCustomizationCreate(paymentCustomization: $in) { paymentCustomization { id } userErrors { field message code } } }`,
      { variables: { in: { title: PC_TITLE, enabled: true, functionHandle: "semafor-hide-payment", metafields: [{ namespace: "$app", key: "blocklist", type: "json", value }] } } })).json();
    const ue = r?.data?.paymentCustomizationCreate?.userErrors;
    if (ue?.length || r.errors) return { ok: false, error: (ue || r.errors).map((e: any) => e.message).join("; ") };
    return { ok: true, created: true };
  }
  if (pc.title !== PC_TITLE) {
    // older installs were created with a Romanian title; Shopify shows it under Settings → Payments → Customizations
    await admin.graphql(`#graphql
      mutation($id: ID!, $in: PaymentCustomizationInput!) { paymentCustomizationUpdate(id: $id, paymentCustomization: $in) { userErrors { message } } }`,
      { variables: { id: pc.id, in: { title: PC_TITLE } } }).catch(() => null);
  }
  if (payload) {
    const r: any = await (await admin.graphql(`#graphql
      mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ field message } } }`,
      { variables: { m: [{ ownerId: pc.id, namespace: "$app", key: "blocklist", type: "json", value }] } })).json();
    const ue = r?.data?.metafieldsSet?.userErrors;
    if (ue?.length) return { ok: false, error: ue.map((e: any) => e.message).join("; ") };
  }
  return { ok: pc.enabled, error: pc.enabled ? undefined : "disabled in Settings → Payments → Customizations" };
}
