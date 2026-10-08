// Other open orders of the same customer → yellow, with a note:
//  • unshipped orders (any payment): "can be merged into one parcel"
//  • unpaid cash-on-delivery order already shipped, not delivered: "wait until they pick it up"
//    (only when THIS order is unpaid too — a paid order is never flagged for this)
type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

export type Related = { unshipped: string[]; codInTransit: string[]; ids: string[] };

const Q = `#graphql
query($q: String!) { orders(first: 15, query: $q, sortKey: CREATED_AT, reverse: true) {
  nodes { id name createdAt cancelledAt closed displayFinancialStatus displayFulfillmentStatus fulfillments(first: 5) { displayStatus } }
} }`;

const NOT_SHIPPED = new Set(["UNFULFILLED", "ON_HOLD", "SCHEDULED", "PENDING_FULFILLMENT", "OPEN", "IN_PROGRESS"]);

export async function findRelated(admin: Admin, order: any): Promise<Related> {
  const out: Related = { unshipped: [], codInTransit: [], ids: [] };
  const cid = order.customer?.id ? String(order.customer.id).split("/").pop() : null;
  const email = order.email || order.customer?.email;
  if (!cid && !email) return out;
  const who = cid ? `customer_id:${cid}` : `email:"${String(email).replace(/"/g, "")}"`;
  // only recent orders: old ones left "unfulfilled" in Shopify are usually already settled
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const j: any = await (await admin.graphql(Q, { variables: { q: `${who} -status:cancelled created_at:>=${since}` } })).json();
  const unshippedSince = Date.now() - 10 * 86_400_000;
  const me = String(order.admin_graphql_api_id || "");
  const thisUnpaid = !order.financial_status || String(order.financial_status).toLowerCase() === "pending";
  for (const o of j?.data?.orders?.nodes ?? []) {
    if (o.id === me || o.cancelledAt || o.closed) continue;
    const shipped = (o.fulfillments || []).length > 0 || !NOT_SHIPPED.has(o.displayFulfillmentStatus);
    if (!shipped) { if (Date.parse(o.createdAt) >= unshippedSince) { out.unshipped.push(o.name); out.ids.push(o.id); } continue; }
    const delivered = (o.fulfillments || []).some((f: any) => f.displayStatus === "DELIVERED");
    if (thisUnpaid && o.displayFinancialStatus === "PENDING" && !delivered) out.codInTransit.push(o.name);
  }
  return out;
}
