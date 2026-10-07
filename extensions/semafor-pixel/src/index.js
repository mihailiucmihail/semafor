// Semafor app pixel: records each checkout step with a random device id kept in the browser,
// so Semafor can link the identities one device tries (own e-mail, then the husband's, …).
import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, init, settings }) => {
  const URL = (settings && settings.endpoint) || "https://semafor-production.up.railway.app/api/attempt";
  const SHOP = (init && init.data && init.data.shop && init.data.shop.myshopifyDomain) || "";
  let devPromise = null;

  function deviceId() {
    if (devPromise) return devPromise;
    devPromise = (async () => {
      try {
        let id = await browser.localStorage.getItem("_smf_dev");
        if (!id) id = await browser.cookie.get("_smf_dev");
        if (!id) {
          id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, "");
        }
        await browser.localStorage.setItem("_smf_dev", id);
        await browser.cookie.set("_smf_dev", id + "; max-age=31536000; path=/; samesite=lax");
        return id;
      } catch (e) { return "nostorage"; }
    })();
    return devPromise;
  }

  async function fingerprint(ctx) {
    try {
      const n = (ctx && ctx.navigator) || {}; const w = (ctx && ctx.window) || {}; const s = w.screen || {};
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const raw = [n.userAgent, n.language, (n.languages || []).join(","), s.width, s.height, w.devicePixelRatio, tz].join("|");
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    } catch (e) { return null; }
  }

  async function send(stage, event) {
    const c = (event && event.data && event.data.checkout) || {};
    const a = c.shippingAddress || c.billingAddress || {};
    const body = {
      shop: SHOP, event: stage, deviceId: await deviceId(), fingerprint: await fingerprint(event.context),
      checkoutToken: c.token || null,
      email: c.email || null, phone: c.phone || a.phone || null,
      firstName: a.firstName || null, lastName: a.lastName || null, address1: a.address1 || null, city: a.city || null,
      orderId: (c.order && c.order.id) || null,
    };
    try { fetch(URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body), keepalive: true }); } catch (e) {}
  }

  analytics.subscribe("checkout_contact_info_submitted", (e) => send("contact", e));
  analytics.subscribe("checkout_address_info_submitted", (e) => send("address", e));
  analytics.subscribe("checkout_shipping_info_submitted", (e) => send("shipping", e));
  analytics.subscribe("payment_info_submitted", (e) => send("payment", e));
  analytics.subscribe("checkout_completed", (e) => send("completed", e));
});
