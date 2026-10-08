// "Comandă cu ramburs încă în drum": the same customer already has an unpaid cash-on-delivery order
// that is not delivered/paid yet. We don't know if they will pay for the first one → yellow.
// Paid orders (card/PayPal) are never flagged.
type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

export type OpenCod = { name: string; status: "neexpediată" | "în drum" };

const Q = `#graphql
query($q: String!) { orders(first: 10, query: $q, sortKey: CREATED_AT, reverse: true) {
  nodes { id name cancelledAt displayFinancialStatus displayFulfillmentStatus fulfillments(first: 5) { displayStatus } }
} }`;

export async function findOpenCod(admin: Admin, order: any): Promise<OpenCod[]> {
  const fin = String(order.financial_status || order.displayFinancialStatus || "").toLowerCase();
  if (fin && fin !== "pending") return []; // this order is already paid → green, no notice
  const cid = order.customer?.id ? String(order.customer.id).split("/").pop() : null;
  const email = order.email || order.customer?.email;
  if (!cid && !email) return [];
  const who = cid ? `customer_id:${cid}` : `email:"${String(email).replace(/"/g, "")}"`;
  const j: any = await (await admin.graphql(Q, { variables: { q: `${who} financial_status:pending -status:cancelled` } })).json();
  const me = String(order.admin_graphql_api_id || "");
  const out: OpenCod[] = [];
  for (const o of j?.data?.orders?.nodes ?? []) {
    if (o.id === me || o.cancelledAt) continue;
    if (o.displayFinancialStatus !== "PENDING") continue;
    const delivered = (o.fulfillments || []).some((f: any) => f.displayStatus === "DELIVERED");
    if (delivered) continue; // delivered but not marked paid yet — courier money on the way, not a risk signal
    out.push({ name: o.name, status: o.displayFulfillmentStatus === "UNFULFILLED" ? "neexpediată" : "în drum" });
  }
  return out;
}
