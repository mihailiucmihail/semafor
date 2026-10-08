// Semafor — Payment Customization Function.
// If the buyer's e-mail, phone or delivery address is on the shop's Semafor blacklist,
// hide EVERY payment method (card, PayPal, cash on delivery …). No message is shown —
// the customer simply cannot pay.
// The blacklist arrives as short SHA-256 hashes in the customization's metafield ($app:blocklist):
//   { v:1, e:[…], p:[…], a:[…], d:[…] }   each = sha256(`${kind}:${normalized}`).slice(0,16)
import { sha256 } from "./sha256.js";
import { normEmail, normPhone, normAddress } from "../../../core/normalize.ts";

const NONE = { operations: [] };

export function cartPaymentMethodsTransformRun(input) {
  const list = input?.paymentCustomization?.metafield?.jsonValue;
  if (!list || !input.paymentMethods || input.paymentMethods.length === 0) return NONE;
  const sets = { e: new Set(list.e || []), p: new Set(list.p || []), a: new Set(list.a || []), d: new Set(list.d || []) };
  const h = (kind, norm) => (norm ? sha256(`${kind}:${norm}`).slice(0, 16) : null);
  const country = input.localization?.country?.isoCode || "RO";
  const cart = input.cart || {};
  const hits = [];

  const email = cart.buyerIdentity?.email;
  if (email) hits.push(sets.e.has(h("email", normEmail(email))));

  const phones = [cart.buyerIdentity?.phone];
  for (const g of cart.deliveryGroups || []) {
    const a = g.deliveryAddress; if (!a) continue;
    phones.push(a.phone);
    const exact = normAddress({ address1: a.address1, address2: a.address2, city: a.city });
    const any = normAddress({ address1: a.address1, address2: a.address2, city: null });
    hits.push(sets.a.has(h("address", exact)) || sets.a.has(h("address", any)));
  }
  for (const p of phones) if (p) hits.push(sets.p.has(h("phone", normPhone(p, country))));

  const dev = cart.attribute?.value;
  if (dev) hits.push(sets.d.has(h("device", String(dev).toLowerCase())));

  if (!hits.some(Boolean)) return NONE;
  return { operations: input.paymentMethods.map((m) => ({ paymentMethodHide: { paymentMethodId: m.id } })) };
}
