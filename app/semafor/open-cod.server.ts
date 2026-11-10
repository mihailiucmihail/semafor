// Other open orders of the same customer → yellow, with a note:
//  • unshipped orders (any payment): "can be merged into one parcel"
//  • unpaid cash-on-delivery order already shipped, not delivered: "wait until they pick it up"
//    (only when THIS order is unpaid too — a paid order is never flagged for this)
import { extractIdentifiers } from "../../core/score";
import { hmacId } from "../../core/hash";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

export type Related = { unshipped: string[]; codInTransit: string[]; ids: string[] };
/** An earlier order of the same person (same phone, or same name + address), whatever its state. */
export type PastOrder = { id: string; name: string; createdAt: string; status: "livrată" | "în curs" | "anulată" | "refuzată" | "retur" | "rambursată"; otherEmail: boolean; bad: boolean; openReturn: boolean };

/** A return the merchant hasn't settled yet: the customer asked for it, or it's approved and on its way back. */
export const OPEN_RETURN = ["RETURN_REQUESTED", "IN_PROGRESS"];
/** Only returns on orders from the last 90 days count — older requests left open in Shopify are usually forgotten, not pending. */
export const OPEN_RETURN_DAYS = 90;
const recentForReturn = (createdAt: string) => Date.parse(createdAt) > Date.now() - OPEN_RETURN_DAYS * 86_400_000;

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

export function toOrderLike(o: any) {
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

const QR = `#graphql
query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id returnStatus } } }`;

/**
 * Every earlier order of the same person — also delivered ones and ones under another Shopify customer / e-mail
 * (Shopify keeps a customer per e-mail, so "same phone, new e-mail" looks like a new customer there).
 * Sources: the same Shopify customer (all time), Semafor's own checks with the same phone / name + address
 * (all time, `otherIds`), and the newest orders compared by phone / name + address.
 * A refused parcel, a return or a refund marks the history as bad.
 */
export async function personHistory(admin: Admin, order: any, country: string, otherIds: string[]): Promise<PastOrder[]> {
  const me = String(order.admin_graphql_api_id || "");
  const cid = order.customer?.id ? String(order.customer.id).split("/").pop() : null;
  const myEmail = String(order.email || order.customer?.email || "").trim().toLowerCase();
  const mine = personKeys(order, country);
  const nodes = new Map<string, any>();
  const add = (list: any[]) => { for (const o of list || []) if (o?.id && o.id !== me) nodes.set(o.id, o); };
  if (cid) {
    const j: any = await (await admin.graphql(Q, { variables: { q: `customer_id:${cid}` } })).json();
    add(j?.data?.orders?.nodes);
  }
  const ids = [...new Set(otherIds)].filter((id) => id !== me).slice(0, 30);
  if (ids.length) {
    const k: any = await (await admin.graphql(QIDS, { variables: { ids } })).json();
    add((k?.data?.nodes ?? []).filter(Boolean));
  }
  if (mine.size) {
    const j: any = await (await admin.graphql(Q, { variables: { q: `created_at:<=${new Date().toISOString().slice(0, 10)}` } })).json();
    for (const o of j?.data?.orders?.nodes ?? []) {
      if (!o?.id || o.id === me || nodes.has(o.id)) continue;
      for (const key of personKeys(toOrderLike(o), country)) if (mine.has(key)) { nodes.set(o.id, o); break; }
    }
  }
  // only orders placed before this one
  const myAt = Date.parse(order.created_at || order.createdAt || "") || Date.now();
  const list = [...nodes.values()].filter((o) => Date.parse(o.createdAt) < myAt);
  if (!list.length) return [];
  // return status: separate query, so a shop without access to it still gets the rest
  const ret = new Map<string, string>();
  try {
    const r: any = await (await admin.graphql(QR, { variables: { ids: list.map((o) => o.id) } })).json();
    for (const n of r?.data?.nodes ?? []) if (n?.id) ret.set(n.id, n.returnStatus);
  } catch { /* no access */ }
  return list
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 10)
    .map((o) => {
      const f = (o.fulfillments || []) as any[];
      const refused = f.some((x) => ["FAILURE", "CANCELED", "NOT_DELIVERED"].includes(x.displayStatus));
      const delivered = f.some((x) => x.displayStatus === "DELIVERED");
      const rs = ret.get(o.id) || "";
      const refunded = ["REFUNDED", "PARTIALLY_REFUNDED"].includes(o.displayFinancialStatus);
      const status: PastOrder["status"] = refused ? "refuzată"
        : ["RETURN_REQUESTED", "IN_PROGRESS", "RETURNED", "INSPECTION_COMPLETE"].includes(rs) ? "retur"
        : refunded ? "rambursată"
        : o.cancelledAt ? "anulată"
        : delivered || (o.displayFulfillmentStatus === "FULFILLED" && o.displayFinancialStatus === "PAID") ? "livrată"
        : "în curs";
      const email = String(o.email || o.customer?.email || "").trim().toLowerCase();
      return { id: o.id, name: o.name, createdAt: o.createdAt, status, otherEmail: !!email && !!myEmail && email !== myEmail, bad: status === "refuzată" || status === "retur" || status === "rambursată", openReturn: OPEN_RETURN.includes(rs) && recentForReturn(o.createdAt) };
    });
}

/** "#4183 livrată 19.10.2026 (alt e-mail)" — Romanian, the canonical stored form (trMsg translates it). */
export function pastOrderText(p: PastOrder): string {
  const d = new Date(p.createdAt);
  const date = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
  return `${p.name} ${p.status} ${date}${p.otherEmail ? " (alt e-mail)" : ""}`;
}

const QRN = `#graphql
query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id name createdAt returnStatus } } }`;

/** Of these orders, the ones whose return is still unsettled (re-checked live; a settled or declined return drops out). */
export async function stillOpenReturns(admin: Admin, ids: string[]): Promise<{ id: string; name: string }[]> {
  const uniq = [...new Set(ids.filter(Boolean))].slice(0, 20);
  if (!uniq.length) return [];
  const r: any = await (await admin.graphql(QRN, { variables: { ids: uniq } })).json();
  if (!r?.data?.nodes) throw new Error(r?.errors?.map((e: any) => e.message).join("; ") || "return status unavailable");
  return (r.data.nodes as any[]).filter((n) => n?.id && OPEN_RETURN.includes(n.returnStatus) && recentForReturn(n.createdAt)).map((n) => ({ id: n.id, name: n.name }));
}

/** Canonical (Romanian) text of the red finding; trMsg translates it. */
export const OPEN_RETURN_REASON = "retur nerezolvat";
export function openReturnText(names: string[]): string {
  return `cerere de retur nerezolvată: ${names.join(", ")} — rezolvă întâi returul (poate fi un schimb), apoi expediază`;
}
