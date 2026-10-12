// Other open orders of the same customer → yellow, with a note:
//  • unshipped orders (any payment): "can be merged into one parcel"
//  • unpaid cash-on-delivery order already shipped, not delivered: "wait until they pick it up"
//    (only when THIS order is unpaid too — a paid order is never flagged for this)
import { extractIdentifiers } from "../../core/score";
import { hmacId } from "../../core/hash";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

export type Related = { unshipped: string[]; codInTransit: string[]; ids: string[] };

const FRAG = `fragment F on Order { id name createdAt cancelledAt closed displayFinancialStatus displayFulfillmentStatus fulfillments(first: 5) { displayStatus }
  email phone customer { email phone firstName lastName }
  shippingAddress { firstName lastName name address1 address2 city zip countryCodeV2 phone }
  billingAddress { firstName lastName name address1 address2 city zip countryCodeV2 phone } }`;
const Q = `#graphql
query($q: String!) { orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ...F } } }
${FRAG}`;
const QIDS = `#graphql
query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { ...F } } }
${FRAG}`;

// Strong identity keys that recognise the same person behind different Shopify customers (other e-mail, guest checkout):
// phone, or name + address together. Never the name alone.
const SAME_PERSON_KINDS = ["phone", "name_address"];

function toOrderLike(o: any) {
  const a = (x: any) => x && { first_name: x.firstName, last_name: x.lastName, name: x.name, address1: x.address1, address2: x.address2, city: x.city, zip: x.zip, country_code: x.countryCodeV2, phone: x.phone };
  return { email: o.email, phone: o.phone, customer: o.customer && { email: o.customer.email, phone: o.customer.phone, first_name: o.customer.firstName, last_name: o.customer.lastName }, shipping_address: a(o.shippingAddress), billing_address: a(o.billingAddress) };
}
function personIds(order: any, country: string) {
  return extractIdentifiers(order, country).filter((i) => SAME_PERSON_KINDS.includes(i.kind));
}
export function personKeys(order: any, country: string): Set<string> {
  return new Set(personIds(order, country).map((i) => `${i.kind}:${i.normalized}`));
}
export function personHashes(secret: string, order: any, country: string): string[] {
  return personIds(order, country).map((i) => hmacId(secret, i.kind, i.normalized));
}

const NOT_SHIPPED = new Set(["UNFULFILLED", "ON_HOLD", "SCHEDULED", "PENDING_FULFILLMENT", "OPEN", "IN_PROGRESS"]);

export async function findRelated(admin: Admin, order: any, same?: { country: string; otherIds?: string[] }): Promise<Related> {
  const out: Related = { unshipped: [], codInTransit: [], ids: [] };
  const cid = order.customer?.id ? String(order.customer.id).split("/").pop() : null;
  const email = order.email || order.customer?.email;
  // only recent orders: old ones left "unfulfilled" in Shopify are usually already settled
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const nodes = new Map<string, any>();
  const add = (list: any[]) => { for (const o of list || []) if (o?.id) nodes.set(o.id, o); };
  // 1) same Shopify customer / same e-mail
  if (cid || email) {
    const who = cid ? `customer_id:${cid}` : `email:"${String(email).replace(/"/g, "")}"`;
    const j: any = await (await admin.graphql(Q, { variables: { q: `${who} -status:cancelled created_at:>=${since}` } })).json();
    add(j?.data?.orders?.nodes);
  }
  // 2) same person under another customer / e-mail: same phone, or same name + address.
  //    Shopify search can't look up a shipping-address phone, so compare recent orders ourselves
  //    (+ orders Semafor already matched by stored hashes, for shops with many orders).
  if (same) {
    const mine = personKeys(order, same.country);
    if (mine.size) {
      const j: any = await (await admin.graphql(Q, { variables: { q: `-status:cancelled created_at:>=${since}` } })).json();
      const recent: any[] = j?.data?.orders?.nodes ?? [];
      if (same.otherIds?.length) {
        const missing = same.otherIds.filter((id) => !recent.some((o) => o.id === id)).slice(0, 15);
        if (missing.length) {
          const k: any = await (await admin.graphql(QIDS, { variables: { ids: missing } })).json();
          recent.push(...(k?.data?.nodes ?? []).filter(Boolean));
        }
      }
      for (const o of recent) {
        if (nodes.has(o.id) || !o.shippingAddress && !o.billingAddress && !o.phone) continue;
        const theirs = personKeys(toOrderLike(o), same.country);
        for (const k of theirs) if (mine.has(k)) { nodes.set(o.id, o); break; }
      }
    }
  }
  const unshippedSince = Date.now() - 10 * 86_400_000;
  const me = String(order.admin_graphql_api_id || "");
  const thisUnpaid = !order.financial_status || String(order.financial_status).toLowerCase() === "pending";
  for (const o of nodes.values()) {
    if (o.id === me || o.cancelledAt || o.closed) continue;
    const shipped = (o.fulfillments || []).length > 0 || !NOT_SHIPPED.has(o.displayFulfillmentStatus);
    if (!shipped) { if (Date.parse(o.createdAt) >= unshippedSince) { out.unshipped.push(o.name); out.ids.push(o.id); } continue; }
    const delivered = (o.fulfillments || []).some((f: any) => f.displayStatus === "DELIVERED");
    if (thisUnpaid && o.displayFinancialStatus === "PENDING" && !delivered) out.codInTransit.push(o.name);
  }
  return out;
}
