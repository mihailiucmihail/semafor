// Launch offer: −50% forever for shops that install before 31 Dec 2026 (all countries).
// Shopify managed pricing has no discount codes, so the offer is two private plans ("Basic Lansare", "Pro Lansare")
// that the owner unlocks per store in the Partner Dashboard. The in-app button only records the request and emails the owner.
import db from "../db.server";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };

/** Last moment to request the offer: 1 Jan 2027 00:00 Bucharest time. */
export const LAUNCH_OFFER_END = Date.UTC(2026, 11, 31, 22, 0, 0);
const COUNTRIES = new Set(["RO", "MD"]);
const kvKey = (shop: string) => `launch-offer:${shop}`;

export async function shopCountry(admin: Admin): Promise<string> {
  try {
    const r = await admin.graphql(`query{ shop{ billingAddress{ countryCodeV2 } } }`);
    const j: any = await r.json();
    if (j?.errors) console.warn("[semafor] shopCountry", JSON.stringify(j.errors).slice(0, 300));
    return String(j?.data?.shop?.billingAddress?.countryCodeV2 || "");
  } catch (e) { console.warn("[semafor] shopCountry", e); return ""; }
}

export async function launchOfferState(admin: Admin, shop: string, owner: boolean) {
  if (owner || Date.now() >= LAUNCH_OFFER_END) return { show: false, requested: false };
  const [country, row] = await Promise.all([shopCountry(admin), db.appKv.findUnique({ where: { key: kvKey(shop) } }).catch(() => null)]);
  return { show: true, requested: !!row }; // all countries (21 Oct 2026); country kept for future targeting
}

export async function requestLaunchOffer(admin: Admin, shop: string) {
  if (Date.now() >= LAUNCH_OFFER_END) return { ok: false };
  const created = await db.appKv.create({ data: { key: kvKey(shop), value: new Date().toISOString() } }).then(() => true, () => false);
  if (!created) return { ok: true }; // already requested; don't email twice
  const to = process.env.LAUNCH_OFFER_EMAIL || process.env.QUOTA_ALERT_EMAIL || "mihailiucmihail@gmail.com";
  if (!process.env.RESEND_API_KEY || to === "off") return { ok: true };
  const { sendMail, shopIdentity } = await import("./recovery.server");
  const me = await shopIdentity(admin as any);
  const pricing = "https://apps.shopify.com/services/pricing/" + (process.env.SHOPIFY_API_KEY || "");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">
<h2 style="margin:0 0 12px">Cerere ofertă de lansare (−50%)</h2>
<p>Magazin: <b>${shop}</b>${me.name ? ` (${me.name.replace(/[<>&]/g, "")})` : ""}</p>
<p>Adaugă domeniul la planurile private <b>basic-lansare</b> și <b>pro-lansare</b> (Stores with plan access → Add → Save).</p>
<p><a href="${pricing}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Deschide prețurile aplicației</a></p></div>`;
  const from = `alerts@${process.env.SEMAFOR_MAIL_DOMAIN || "semafor.kastelmail.com"}`;
  await sendMail({ to, subject: `Semafor: ofertă de lansare pentru ${shop}`, html, fromName: "Semafor", fromEmail: from, replyTo: me.email || undefined })
    .catch((e) => console.error("[semafor] launch offer mail", e));
  return { ok: true };
}
