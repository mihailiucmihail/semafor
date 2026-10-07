/**
 * Shop-level webhook registration.
 *
 * Webhooks declared in shopify.app.toml only take effect after `shopify app deploy`.
 * The app was released from the Dev Dashboard without that step, so Shopify never
 * sent orders/create. Here the app registers the subscriptions it needs itself,
 * through the Admin API, the first time an admin opens it (and re-checks every hour).
 */

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

const NEEDED: { topic: string; path: string }[] = [
  { topic: "ORDERS_CREATE", path: "/webhooks/orders/create" },
  { topic: "APP_UNINSTALLED", path: "/webhooks/app/uninstalled" },
];

export type WebhookStatus = { topic: string; ok: boolean; uri?: string; error?: string };

const lastCheck = new Map<string, { at: number; status: WebhookStatus[] }>();
const TTL = 60 * 60 * 1000;

function baseUrl() {
  return (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
}

export async function ensureWebhooks(admin: Admin, shop: string, force = false): Promise<WebhookStatus[]> {
  const cached = lastCheck.get(shop);
  if (!force && cached && Date.now() - cached.at < TTL && cached.status.every((s) => s.ok)) return cached.status;

  const status: WebhookStatus[] = [];
  let existing: { id: string; topic: string; uri: string }[] = [];
  try {
    const r = await admin.graphql(`query { webhookSubscriptions(first: 50) { nodes { id topic uri } } }`);
    const j: any = await r.json();
    existing = j?.data?.webhookSubscriptions?.nodes ?? [];
  } catch (e: any) {
    console.error("[semafor] webhookSubscriptions query failed", e?.message || e);
  }

  for (const n of NEEDED) {
    const uri = baseUrl() + n.path;
    const have = existing.find((e) => e.topic === n.topic && e.uri === uri);
    if (have) { status.push({ topic: n.topic, ok: true, uri }); continue; }
    try {
      const r = await admin.graphql(
        `mutation($topic: WebhookSubscriptionTopic!, $uri: String!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) { webhookSubscription { id topic uri } userErrors { field message } } }`,
        { variables: { topic: n.topic, uri } },
      );
      const j: any = await r.json();
      const res = j?.data?.webhookSubscriptionCreate;
      const err = res?.userErrors?.map((u: any) => u.message).join("; ") || j?.errors?.map((x: any) => x.message).join("; ");
      if (res?.webhookSubscription) status.push({ topic: n.topic, ok: true, uri });
      else status.push({ topic: n.topic, ok: false, uri, error: err || "unknown error" });
    } catch (e: any) {
      const msg = e?.body?.errors?.graphQLErrors?.map((g: any) => g.message).join("; ") || e?.message || String(e);
      status.push({ topic: n.topic, ok: false, uri, error: msg });
    }
  }

  for (const s of status) console.log(`[semafor] webhook ${s.topic} ${s.ok ? "ok" : "FAILED: " + s.error} (${shop})`);
  lastCheck.set(shop, { at: Date.now(), status });
  return status;
}
