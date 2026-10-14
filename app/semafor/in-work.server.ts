// "Your order is being prepared" e-mail, sent once when the order's fulfillment goes IN_PROGRESS
// (Fan Shipping marks the items "in progress" when the AWB is generated in the morning).
// Owner shops only for now (merchant-specific flow). Packeta (DE/PL) fulfils directly, so those orders
// skip this step and get the shipping confirmation straight away.
import db from "../db.server";
import { isOwnerShop } from "./plan.server";
import { sendMail, senderOf, shopIdentity } from "./recovery.server";
import { settingsOf } from "../../core/settings";
import { esc } from "./render";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

const TXT: Record<string, { subject: (n: string) => string; hi: (f: string) => string; p1: string; p2: string; btn: string; bye: string; foot: string }> = {
  ro: {
    subject: (n) => `Comanda ta ${n} este în pregătire`,
    hi: (f) => (f ? `Bună, ${f}!` : "Bună!"),
    p1: "Comanda ta a intrat în pregătire. O verificăm cu grijă și o ambalăm pentru livrare.",
    p2: "Când coletul pleacă, primești pe e-mail numărul de urmărire.",
    btn: "Vezi comanda",
    bye: "Cu drag,",
    foot: "Mihailiuc Group SRL · București, România",
  },
  de: {
    subject: (n) => `Deine Bestellung ${n} wird vorbereitet`,
    hi: (f) => (f ? `Hallo ${f}!` : "Hallo!"),
    p1: "Deine Bestellung ist jetzt in Bearbeitung. Wir prüfen sie sorgfältig und verpacken sie für den Versand.",
    p2: "Sobald das Paket unterwegs ist, bekommst du die Sendungsnummer per E-Mail.",
    btn: "Bestellung ansehen",
    bye: "Herzliche Grüße,",
    foot: "Mihailiuc Group SRL · Bukarest, Rumänien",
  },
  pl: {
    subject: (n) => `Twoje zamówienie ${n} jest w przygotowaniu`,
    hi: (f) => (f ? `Cześć, ${f}!` : "Cześć!"),
    p1: "Twoje zamówienie jest w trakcie realizacji. Starannie je sprawdzamy i pakujemy do wysyłki.",
    p2: "Gdy paczka wyruszy, otrzymasz e-mailem numer do śledzenia przesyłki.",
    btn: "Zobacz zamówienie",
    bye: "Pozdrawiamy serdecznie,",
    foot: "Mihailiuc Group SRL · Bukareszt, Rumunia",
  },
};

function lang(p: any) {
  const l = String(p?.customer_locale || "").slice(0, 2).toLowerCase();
  if (TXT[l]) return l;
  const c = String(p?.shipping_address?.country_code || "").toUpperCase();
  return c === "DE" || c === "AT" ? "de" : c === "PL" ? "pl" : "ro";
}

export function inWorkHtml(l: string, first: string, name: string, img: string | null, statusUrl: string | null) {
  const t = TXT[l] || TXT.ro;
  return `<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#efe8dd">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#efe8dd"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#faf7f2" style="width:100%;max-width:560px;background:#faf7f2;border-radius:10px">
<tr><td align="center" style="padding:32px 30px 24px">
<div style="font-family:'Jost',Helvetica,Arial,sans-serif;font-weight:300;font-size:36px;line-height:1;letter-spacing:.08em;padding-left:.08em;color:#2a1a12">MIA</div>
<div style="font-family:'Jost',Helvetica,Arial,sans-serif;font-size:8px;line-height:1;letter-spacing:.42em;padding:7px 0 0 .42em;color:#2a1a12;text-transform:uppercase">by Mihailiuc</div>
</td></tr>
${img ? `<tr><td align="center" style="padding:0 30px 6px"><img src="${esc(img)}" width="220" alt="" style="display:block;width:220px;max-width:70%;height:auto;border-radius:8px;border:0"></td></tr>` : ""}
<tr><td style="padding:22px 36px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#3a2a20">
<p style="margin:0 0 14px">${esc(t.hi(first))}</p>
<p style="margin:0 0 14px">${esc(t.p1)}</p>
<p style="margin:0">${esc(t.p2)}</p>
</td></tr>
${statusUrl ? `<tr><td align="center" style="padding:26px 30px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border:1px solid #2a1a12;border-radius:40px"><a href="${esc(statusUrl)}" style="display:inline-block;padding:13px 34px;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#2a1a12;text-decoration:none">${esc(t.btn)} ${esc(name)}</a></td></tr></table></td></tr>` : ""}
<tr><td style="padding:26px 36px 34px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3a2a20">${esc(t.bye)}<br>MIHAILIUC</td></tr>
<tr><td align="center" bgcolor="#2a1a12" style="background:#2a1a12;padding:20px;border-radius:0 0 10px 10px;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#c9b8a8">${esc(t.foot)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** orders/updated (owner shop): if the order just went "in progress", e-mail the buyer once. */
export async function notifyInWork(admin: Admin, shop: { id: string; domain: string; settings: any }, p: any) {
  if (!isOwnerShop(shop.domain)) return;
  if (p?.cancelled_at || p?.fulfillment_status === "fulfilled") return;
  const created = Date.parse(p?.created_at || "");
  if (!created || Date.now() - created > 10 * 864e5) return; // only recent orders
  const to = String(p?.email || p?.contact_email || p?.customer?.email || "").trim();
  const orderId = String(p?.admin_graphql_api_id || "");
  if (!to || !orderId) return;
  const lock = `inwork_${orderId.split("/").pop()}`;
  if (await db.emailSend.findUnique({ where: { id: lock } })) return;

  const r: any = await (await admin.graphql(`#graphql
    query($id:ID!){ order(id:$id){ name statusPageUrl displayFulfillmentStatus
      lineItems(first:3){ nodes{ image{ url } variant{ image{ url } } product{ featuredMedia{ preview{ image{ url } } } } } } } }`, { variables: { id: orderId } })).json();
  const o = r?.data?.order;
  if (!o) return;
  if (o.displayFulfillmentStatus !== "IN_PROGRESS") return; // read_orders only, no fulfillment-order scopes needed

  try { // the row id is the lock: once per order, even if two webhooks arrive together
    await db.emailSend.create({ data: { id: lock, shopId: shop.id, deviceId: orderId, email: to, subject: "-", kind: "order_in_work", status: "pending" } });
  } catch { return; }

  const l = lang(p);
  const li = o.lineItems?.nodes?.[0];
  const img0 = li?.variant?.image?.url || li?.image?.url || li?.product?.featuredMedia?.preview?.image?.url || null;
  const img = img0 ? img0 + (img0.includes("?") ? "&" : "?") + "width=600" : null;
  const first = String(p?.shipping_address?.first_name || p?.customer?.first_name || p?.billing_address?.first_name || "").trim();
  const subject = (TXT[l] || TXT.ro).subject(String(o.name || p?.name || ""));
  const html = inWorkHtml(l, first, String(o.name || ""), img, o.statusPageUrl || null);
  try {
    const me = await shopIdentity(admin as any);
    const fromEmail = await senderOf(shop.domain, settingsOf(shop.settings).recovery);
    const id = await sendMail({ to, subject, html, fromName: "MIHAILIUC", fromEmail, replyTo: me.email || undefined });
    await db.emailSend.update({ where: { id: lock }, data: { status: "sent", providerId: id, subject, html } });
    console.log(`[semafor] in-work e-mail ${shop.domain} ${o.name} → sent`);
  } catch (e: any) {
    await db.emailSend.update({ where: { id: lock }, data: { status: "failed", error: String(e?.message || e).slice(0, 300) } });
  }
}
