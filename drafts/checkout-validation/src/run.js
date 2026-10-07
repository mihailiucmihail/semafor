// Refuz — Cart & Checkout Validation Function.
// Reads short hashes from the shop metafield `semafor.blocklist` (JSON: {"v":1,"e":[...],"p":[...],"a":[...],"d":[...]})
// and blocks checkout on an exact match. No network access here by design.
//
// Hashing inside a Function: we cannot do HMAC with a secret (the secret would be in the metafield),
// so the server writes a *second* set of hashes computed with plain SHA-256 over the normalized value
// — still not reversible for the customer, and only the checkout path uses them.
import { sha256 } from './sha256.js';
import { normEmail, normPhone, normAddress } from './normalize-lite.js';

/** @param {import("../generated/api").RunInput} input */
export function run(input) {
  const raw = input.shop?.metafield?.value;
  if (!raw) return { errors: [] };
  let list;
  try { list = JSON.parse(raw); } catch { return { errors: [] }; }
  const sets = { e: new Set(list.e || []), p: new Set(list.p || []), a: new Set(list.a || []), d: new Set(list.d || []) };
  const country = (input.localization?.country?.isoCode) || 'RO';
  const msg = list.msg || 'Nu putem finaliza această comandă. Vă rugăm să ne contactați.';

  const email = input.buyerIdentity?.email || null;
  const phone = input.buyerIdentity?.phone || input.cart?.deliveryGroups?.[0]?.deliveryAddress?.phone || null;
  const addr = input.cart?.deliveryGroups?.[0]?.deliveryAddress || null;
  const dev = (input.cart?.attribute?.value) || null;

  const hit = (set, kind, norm) => norm && set.has(sha256(`${kind}:${norm}`).slice(0, 16));

  if (email && hit(sets.e, 'email', normEmail(email))) return block(msg, '$.cart.buyerIdentity.email');
  if (phone && hit(sets.p, 'phone', normPhone(phone, country))) return block(msg, '$.cart.deliveryGroups[0].deliveryAddress.phone');
  if (addr && hit(sets.a, 'address', normAddress({ address1: addr.address1, address2: addr.address2, city: addr.city }))) return block(msg, '$.cart.deliveryGroups[0].deliveryAddress.address1');
  if (dev && sets.d.has(sha256(`device:${dev.toLowerCase()}`).slice(0, 16))) return block(msg, '$.cart');
  return { errors: [] };
}

function block(message, target) {
  return { errors: [{ localizedMessage: message, target }] };
}
