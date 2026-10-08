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
  { topic: "ORDERS_PAID", path: "/webhooks/orders/status" },
  { topic: "ORDERS_CANCELLED", path: "/webhooks/orders/status" },
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
      if (res?.webhookSubscription || /already been taken/i.test(err || "")) status.push({ topic: n.topic, ok: true, uri });
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

/** Activate the Semafor app pixel (web pixel extension) on this shop. Needs write_pixels + read_customer_events. */
const pixelDone = new Set<string>();
export async function ensurePixel(admin: Admin, shop: string, force = false): Promise<WebhookStatus> {
  if (!force && pixelDone.has(shop)) return { topic: "PIXEL", ok: true };
  const settings = JSON.stringify({ endpoint: baseUrl() + "/api/attempt" });
  try {
    const q: any = await (await admin.graphql(`query { webPixel { id settings } }`)).json();
    const existing = q?.data?.webPixel;
    if (existing?.id) {
      if (existing.settings !== settings) {
        await admin.graphql(`mutation($id: ID!, $s: JSON!) { webPixelUpdate(id: $id, webPixel: { settings: $s }) { userErrors { message } } }`, { variables: { id: existing.id, s: settings } });
      }
      pixelDone.add(shop);
      return { topic: "PIXEL", ok: true };
    }
  } catch { /* no pixel yet, or no scope — try create below */ }
  try {
    const j: any = await (await admin.graphql(
      `mutation($s: JSON!) { webPixelCreate(webPixel: { settings: $s }) { webPixel { id } userErrors { field message code } } }`,
      { variables: { s: settings } },
    )).json();
    const r = j?.data?.webPixelCreate;
    const err = r?.userErrors?.map((u: any) => `${u.code || ""} ${u.message}`).join("; ") || j?.errors?.map((x: any) => x.message).join("; ");
    if (r?.webPixel?.id || /taken|already/i.test(err || "")) { pixelDone.add(shop); console.log(`[semafor] pixel ok (${shop})`); return { topic: "PIXEL", ok: true }; }
    console.log(`[semafor] pixel FAILED: ${err} (${shop})`);
    return { topic: "PIXEL", ok: false, error: err || "unknown error" };
  } catch (e: any) {
    const msg = e?.body?.errors?.graphQLErrors?.map((g: any) => g.message).join("; ") || e?.message || String(e);
    console.log(`[semafor] pixel FAILED: ${msg} (${shop})`);
    return { topic: "PIXEL", ok: false, error: msg };
  }
}
