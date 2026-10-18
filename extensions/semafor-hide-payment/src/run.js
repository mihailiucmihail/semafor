// Semafor — Payment Customization Function.
// If the buyer's e-mail, phone, delivery address, name or device is on the shop's Semafor blacklist (red) or
// flagged by fewer shops in the network (yellow), the merchant's choice for that level is applied:
//   all  → hide EVERY payment method (the order cannot be placed; no message is shown)
//   cod  → hide only cash on delivery (card / other methods still work)
//   none → hide nothing (the order is only flagged after it is placed)
// m = { r, y } in the payload; payloads without m (v:1) hide everything for a hit, as before.
// The blacklist arrives as short SHA-256 hashes in the customization's metafield ($app:blocklist):
//   { v:1, e:[…], p:[…], a:[…], d:[…], n:[full names], w:[single name words] }   each = sha256(`${kind}:${normalized}`).slice(0,16)
//
// Shopify caps a Function at 11M instructions and SHA-256 in JS is the expensive part, so:
// hash only when that bucket has entries, never hash the same value twice, stop at the first hit.
import { sha256 } from "./sha256.js";
import { normEmail, normPhone, normAddress, normName } from "../../../core/normalize.ts";

const NONE = { operations: [] };

/** Cash on delivery, whatever the shop called it (RO / EN / DE / PL / ES / FR / IT / BG / RU names). */
const COD_RE = /cash\s*on\s*delivery|\bcod\b|ramburs|nachnahme|pobrani|contra\s*reembolso|contre[\s-]*remboursement|contrassegno|наложен|при\s*доставк|plata\s*la\s*livrare|bei\s*lieferung/i;

export function cartPaymentMethodsTransformRun(input) {
  const list = input?.paymentCustomization?.metafield?.jsonValue;
  if (!list || !input.paymentMethods || input.paymentMethods.length === 0) return NONE;
  const mode = (x, d) => (x === "all" || x === "cod" || x === "none" ? x : d);
  const mR = mode(list.m && list.m.r, "all"), mY = mode(list.m && list.m.y, "none");
  const act = (m) => {
    if (m === "all") return { operations: input.paymentMethods.map((p) => ({ paymentMethodHide: { paymentMethodId: p.id } })) };
    if (m === "cod") { const ops = input.paymentMethods.filter((p) => COD_RE.test(p.name || "")).map((p) => ({ paymentMethodHide: { paymentMethodId: p.id } })); return { operations: ops }; }
    return NONE;
  };
  // yellow level (network only): checked after the red list, with its own action
  const y = list.y || {};
  const ySets = {};
  if (mY !== "none") for (const k of ["e", "p"]) if (y[k] && y[k].length) ySets[k] = new Set(y[k]);
  const sets = {};
  if (mR !== "none") for (const k of ["e", "p", "a", "d", "n", "w"]) if (list[k] && list[k].length) sets[k] = new Set(list[k]);
  // older payloads kept single-word name entries in `n` too
  if (!Array.isArray(list.w) && sets.n) sets.w = sets.n;
  const anyRed = !!(sets.e || sets.p || sets.a || sets.d || sets.n || sets.w);
  if (!anyRed && !ySets.e && !ySets.p) return NONE;

  const done = new Set();
  const hit = (bucket, kind, norm) => {
    const set = sets[bucket];
    if (!set || !norm) return false;
    const key = `${kind}:${norm}`;
    if (done.has(key)) return false;
    done.add(key);
    return set.has(sha256(key, 16));
  };
  const hideAll = () => act(mR);

  const country = input.localization?.country?.isoCode || "RO";
  const cart = input.cart || {};
  const groups = cart.deliveryGroups || [];

  if (sets.e && cart.buyerIdentity?.email && hit("e", "email", normEmail(cart.buyerIdentity.email))) return hideAll();

  if (sets.p) {
    const phones = [cart.buyerIdentity?.phone];
    for (const g of groups) phones.push(g.deliveryAddress?.phone);
    for (const p of phones) if (p && hit("p", "phone", normPhone(p, country))) return hideAll();
  }

  for (const g of groups) {
    const a = g.deliveryAddress;
    if (!a) continue;
    if (sets.a) {
      if (hit("a", "address", normAddress({ address1: a.address1, address2: a.address2, city: a.city }))) return hideAll();
      if (hit("a", "address", normAddress({ address1: a.address1, address2: a.address2, city: null }))) return hideAll();
    }
    // name-only entries: full name (any word order) or a single blocked word anywhere in the name
    if (sets.n || sets.w) {
      const n = normName(a.firstName, a.lastName);
      if (n) {
        if (hit("n", "name", n)) return hideAll();
        if (sets.w) for (const w of n.split(" ")) if (hit("w", "nw", w)) return hideAll();
      }
    }
  }

  const dev = cart.attribute?.value;
  if (sets.d && dev && hit("d", "device", String(dev).toLowerCase())) return hideAll();

  // yellow (network): same hashing, separate sets
  if (ySets.e || ySets.p) {
    const yh = (set, kind, norm) => !!(set && norm && set.has(sha256(`${kind}:${norm}`, 16)));
    if (cart.buyerIdentity?.email && yh(ySets.e, "email", normEmail(cart.buyerIdentity.email))) return act(mY);
    const phones = [cart.buyerIdentity?.phone];
    for (const g of groups) phones.push(g.deliveryAddress?.phone);
    for (const p of phones) if (p && yh(ySets.p, "phone", normPhone(p, country))) return act(mY);
  }

  return NONE;
}
