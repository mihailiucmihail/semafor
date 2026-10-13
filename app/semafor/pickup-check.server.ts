// Pickup point far from the buyer's address (FAN Courier FANbox via the "Fan Shipping" app).
// Shopify pre-selects the cheapest delivery option, so many buyers end up with a FANbox locker without noticing.
// When the chosen locker is more than FAR_KM from the shipping address, Semafor:
//   • tags the order "📍 FANbox departe" (so the merchant sees it in the order list),
//   • e-mails the buyer once, asking them to reply if they prefer courier delivery to their address.
// Owner shops only for now (merchant-specific integration).
import db from "../db.server";
import { isOwnerShop } from "./plan.server";
import { sendMail, senderOf, shopIdentity } from "./recovery.server";
import { settingsOf } from "../../core/settings";
import { esc } from "./render";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };
const FAR_KM = 2;
export const FAR_TAG = "📍 FANbox departe";

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pickupInfo(order: any) {
  const line = (order.shipping_lines || [])[0];
  const lineTitle = String(line?.title || "");
  const attr = (order.note_attributes || []).find((a: any) => a?.name === "Pickup Point");
  // the checkout title may be renamed (Shipy: "Automat FANbox (ridici singur…)"), so rely on the pickup point data
  if (!attr && !/FANbox/i.test(lineTitle)) return null;
  let pp: any = null;
  try { pp = JSON.parse(String(attr?.value || "")); } catch { return null; }
  const title = String(pp?.office || lineTitle);
  if (!/FANbox/i.test(title)) return null;
  const loc = pp?.data?.x_pickupLocation;
  const p = loc?.addressPoint;
  const s = order.shipping_address;
  if (!p?.latitude || !s?.latitude) return null;
  const dist = km({ lat: Number(s.latitude), lng: Number(s.longitude) }, { lat: Number(p.latitude), lng: Number(p.longitude) });
  const where = [loc?.address?.street, loc?.address?.town].filter(Boolean).join(", ");
  return { title, where, km: Math.round(dist * 10) / 10, address: [s.address1, s.address2, s.city].filter(Boolean).join(", "), first: String(s.first_name || order.customer?.first_name || "").trim() };
}

export async function checkPickupDistance(admin: Admin, shop: { id: string; domain: string; settings: any }, order: any) {
  if (!isOwnerShop(shop.domain)) return;
  const info = pickupInfo(order);
  if (!info || info.km <= FAR_KM) return;
  const orderId = String(order.admin_graphql_api_id || "");
  const to = String(order.email || order.contact_email || order.customer?.email || "").trim();
  // Once per order, even if both Semafor apps receive the webhook: the row id is the lock.
  try {
    await db.emailSend.create({ data: { id: `fbfar_${orderId.split("/").pop()}`, shopId: shop.id, deviceId: orderId, email: to || "-", subject: "-", kind: "fanbox_far", status: "pending" } });
  } catch { return; }

  await admin.graphql(`#graphql
    mutation($id:ID!,$tags:[String!]!){ tagsAdd(id:$id,tags:$tags){ userErrors{ message } } }`, { variables: { id: orderId, tags: [FAR_TAG] } }).catch(() => {});

  if (!to) { await db.emailSend.update({ where: { id: `fbfar_${orderId.split("/").pop()}` }, data: { status: "skipped", error: "no email" } }); return; }
  const me = await shopIdentity(admin as any);
  const fromEmail = await senderOf(shop.domain, settingsOf(shop.settings).recovery);
  const name = String(order.name || "");
  const hi = info.first ? `Bună, ${esc(info.first)}!` : "Bună!";
  const subject = `Comanda ${name}: va fi livrată în FANbox, la ${String(info.km).replace(".", ",")} km de tine`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f1ea;font-family:Georgia,'Times New Roman',serif;color:#2b1d14">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<div style="background:#fff;border-radius:14px;padding:28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">
<p style="margin:0 0 14px">${hi}</p>
<p style="margin:0 0 14px">La comanda <b>${esc(name)}</b> a fost aleasă livrarea în automatul <b>${esc(info.title)}</b>${info.where ? ` (${esc(info.where)})` : ""}, la aproximativ <b>${String(info.km).replace(".", ",")} km</b> de adresa ta (${esc(info.address)}).</p>
<p style="margin:0 0 14px">Cu FANbox, curierul <b>nu vine la ușă</b>: coletul se ridică din automat, cu codul primit prin SMS de la FAN Courier.</p>
<div style="background:#f6f1ea;border-radius:10px;padding:14px 16px;margin:0 0 14px"><b>Preferi livrare prin curier la adresa ta?</b><br>Răspunde la acest e-mail cu <b>„LA ADRESĂ”</b> cât mai repede, înainte să predăm coletul, și o schimbăm noi.</div>
<p style="margin:0">Dacă FANbox-ul îți convine, nu trebuie să faci nimic.</p>
<p style="margin:18px 0 0">Mulțumim,<br>${esc(me.name || "MIHAILIUC")}</p>
</div></div></body></html>`;
  try {
    const id = await sendMail({ to, subject, html, fromName: me.name || "MIHAILIUC", fromEmail, replyTo: me.email || undefined });
    await db.emailSend.update({ where: { id: `fbfar_${orderId.split("/").pop()}` }, data: { status: "sent", providerId: id, subject, html } });
    console.log(`[semafor] fanbox-far ${shop.domain} ${name} ${info.km} km → e-mail sent`);
  } catch (e: any) {
    await db.emailSend.update({ where: { id: `fbfar_${orderId.split("/").pop()}` }, data: { status: "failed", error: String(e?.message || e).slice(0, 300) } });
  }
}
