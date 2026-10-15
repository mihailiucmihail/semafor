// Semafor — Payment Customization Function.
// If the buyer's e-mail, phone, delivery address, name or device is on the shop's Semafor blacklist,
// hide EVERY payment method (card, PayPal, cash on delivery …). No message is shown —
// the customer simply cannot pay.
// The blacklist arrives as short SHA-256 hashes in the customization's metafield ($app:blocklist):
//   { v:1, e:[…], p:[…], a:[…], d:[…], n:[full names], w:[single name words] }   each = sha256(`${kind}:${normalized}`).slice(0,16)
//
// Shopify caps a Function at 11M instructions and SHA-256 in JS is the expensive part, so:
// hash only when that bucket has entries, never hash the same value twice, stop at the first hit.
import { sha256 } from "./sha256.js";
import { normEmail, normPhone, normAddress, normName } from "../../../core/normalize.ts";

const NONE = { operations: [] };

export function cartPaymentMethodsTransformRun(input) {
  const list = input?.paymentCustomization?.metafield?.jsonValue;
  if (!list || !input.paymentMethods || input.paymentMethods.length === 0) return NONE;
  const sets = {};
  for (const k of ["e", "p", "a", "d", "n", "w"]) if (list[k] && list[k].length) sets[k] = new Set(list[k]);
  // older payloads kept single-word name entries in `n` too
  if (!Array.isArray(list.w) && sets.n) sets.w = sets.n;
  if (!sets.e && !sets.p && !sets.a && !sets.d && !sets.n && !sets.w) return NONE;

  const done = new Set();
  const hit = (bucket, kind, norm) => {
    const set = sets[bucket];
    if (!set || !norm) return false;
    const key = `${kind}:${norm}`;
    if (done.has(key)) return false;
    done.add(key);
    return set.has(sha256(key, 16));
  };
  const hideAll = () => ({ operations: input.paymentMethods.map((m) => ({ paymentMethodHide: { paymentMethodId: m.id } })) });

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

  return NONE;
}
