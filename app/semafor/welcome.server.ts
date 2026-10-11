/**
 * Welcome e-mail after a pop-up subscription: the discount code + an "apply" button, in the subscriber's storefront
 * language, built with the same designs as the recovery e-mails (design of the shop's own reminder template,
 * brand name / logo / accent from the e-mail settings) and sent through the same pipeline (Resend, sender,
 * reply-to, unsubscribe link, EmailSend log with kind "welcome").
 */
import db from "../db.server";
import { POPUP_LANGS, type PopupLang, type PopupSettings, type ShopSettings } from "../../core/settings";
import { codeForLang, welcomeTexts } from "../../core/popup";
import { buildEmail, isDesign, type DesignId } from "./designs";
import { render } from "./render";
import { brandOf, isOptedOut, sendMail, senderOf, unsubUrl, withUnsubFooter, UNSUB_LABEL, UNSUB_PH, DAILY_LIMIT } from "./recovery.server";

type Admin = { graphql: (q: string, o?: any) => Promise<Response> };
const DAY = 86_400_000;

const WHY: Record<PopupLang, string> = {
  ro: "Primești acest e-mail pentru că te-ai abonat la noutățile {{shop_name}}.",
  de: "Du erhältst diese E-Mail, weil du die Neuigkeiten von {{shop_name}} abonniert hast.",
  pl: "Otrzymujesz tę wiadomość, ponieważ zapisałaś się na nowości {{shop_name}}.",
  en: "You're receiving this e-mail because you subscribed to {{shop_name}} news.",
};

export const langOf = (l: string | null | undefined): PopupLang => {
  const x = String(l || "").slice(0, 2).toLowerCase();
  return (POPUP_LANGS as string[]).includes(x) ? (x as PopupLang) : "en";
};

/** Shop name, reply-to and the storefront base URL (the host she subscribed on, when it is one of the shop's domains). */
async function shopInfo(admin: Admin, host: string | null, shopDomain: string) {
  let name = "", email = "", primary = `https://${shopDomain}`, hosts: string[] = [shopDomain];
  try {
    const j: any = await (await admin.graphql(`query { shop { name contactEmail email primaryDomain { url host } domains { host } } }`)).json();
    const s = j?.data?.shop;
    name = s?.name || ""; email = s?.contactEmail || s?.email || "";
    if (s?.primaryDomain?.url) primary = String(s.primaryDomain.url).replace(/\/$/, "");
    hosts = [shopDomain, s?.primaryDomain?.host, ...((s?.domains ?? []) as any[]).map((d) => d?.host)].filter(Boolean).map((h: string) => h.toLowerCase());
  } catch (e: any) { console.error("[semafor] welcome shop info", e?.message || e); }
  const h = String(host || "").toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
  const base = h && hosts.includes(h) ? `https://${h}` : primary;
  return { name, email, base };
}

/** Design of the shop's own first reminder in that language (else elegant), so all e-mails look alike. */
async function designFor(shopId: string, lang: string): Promise<DesignId> {
  const t = (await db.emailTemplate.findFirst({ where: { shopId, purpose: "auto1", locale: lang }, orderBy: { updatedAt: "desc" }, select: { design: true } }))
    ?? (await db.emailTemplate.findFirst({ where: { shopId, purpose: "auto1" }, orderBy: { updatedAt: "desc" }, select: { design: true } }));
  return isDesign(t?.design) ? t!.design as DesignId : "elegant";
}

export type WelcomeInput = {
  shop: { id: string; domain: string; settings: ShopSettings };
  admin: Admin;
  to: string; locale: string | null; host: string | null; deviceId: string;
  /** settings to use instead of the saved ones (admin "send test" with unsaved changes) */
  popup?: PopupSettings;
  test?: boolean;
  /** only build it (admin preview) */
  preview?: boolean;
};

/** Builds and (unless preview) sends the welcome e-mail. Test sends are not logged and never unsubscribe anybody. */
export async function sendWelcome(i: WelcomeInput) {
  const p = i.popup ?? i.shop.settings.popup;
  const s = i.shop.settings.recovery;
  const lang = langOf(i.locale);
  const info = await shopInfo(i.admin, i.host, i.shop.domain);
  const shopName = s.fromName || info.name;
  const fill = (x: string) => x.replace(/\{shop\}/g, s.brandName || info.name).replace(/\{pct\}/g, String(p.pct));
  const t = welcomeTexts(p, lang);
  const design = await designFor(i.shop.id, lang);
  const html0 = buildEmail(design, { greeting: "", heading: fill(t.heading), text: fill(t.text), button: fill(t.button), note: fill(t.note), discount: fill(t.codeLabel) }, brandOf(s, info.name), { codeBox: true });
  const code = codeForLang(p, lang);
  const url = `${info.base}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent("/")}`;
  const out = render({ subject: fill(t.subject), html: html0 }, {
    recovery_url: url, discount_code: code, discount_pct: String(p.pct), shop_name: shopName, product_block: "", items: "",
    unsubscribe_url: UNSUB_PH, unsubscribe_label: (UNSUB_LABEL[lang] || UNSUB_LABEL.en).link, unsubscribe_why: WHY[lang].replace("{{shop_name}}", shopName),
  }, true);
  if (i.preview) return { ...out, sent: false };

  const uurl = unsubUrl(i.shop.id, i.to) + (i.test ? "&test=1" : "");
  const html = withUnsubFooter(out.html.split(UNSUB_PH).join(uurl), uurl, lang, shopName);
  const subject = (i.test ? "[TEST] " : "") + out.subject;
  if (i.test) {
    await sendMail({ to: i.to, subject, html, fromName: shopName, fromEmail: await senderOf(i.shop.domain, s), replyTo: s.replyTo || info.email || undefined, unsubscribeUrl: uurl });
    return { ...out, sent: true };
  }
  try {
    const sentToday = await db.emailSend.count({ where: { shopId: i.shop.id, status: "sent", createdAt: { gt: new Date(Date.now() - DAY) } } });
    if (sentToday >= DAILY_LIMIT) throw new Error(`Limita zilnică de ${DAILY_LIMIT} e-mailuri a fost atinsă.`);
    const providerId = await sendMail({ to: i.to, subject, html, fromName: shopName, fromEmail: await senderOf(i.shop.domain, s), replyTo: s.replyTo || info.email || undefined, unsubscribeUrl: uurl });
    await db.emailSend.create({ data: { shopId: i.shop.id, deviceId: i.deviceId, email: i.to, subject, kind: "welcome", discountCode: code, discountPct: p.pct, status: "sent", providerId, html } });
    return { ...out, sent: true };
  } catch (e: any) {
    await db.emailSend.create({ data: { shopId: i.shop.id, deviceId: i.deviceId, email: i.to, subject, kind: "welcome", discountCode: code, discountPct: p.pct, status: "failed", error: String(e?.message || e).slice(0, 500) } });
    throw e;
  }
}

const inFlight = new Set<string>();
/**
 * After a pop-up subscription: send the welcome e-mail once per shop + e-mail (not again within 30 days, not to
 * unsubscribed people). Runs in the background — never blocks the visitor.
 */
export function welcomeAfterSubscribe(i: Omit<WelcomeInput, "test" | "preview" | "popup">) {
  if (!i.shop.settings.popup.welcome) return;
  const key = `${i.shop.id}:${i.to}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  (async () => {
    try {
      const recent = await db.emailSend.findFirst({ where: { shopId: i.shop.id, email: { equals: i.to, mode: "insensitive" }, kind: "welcome", status: "sent", createdAt: { gt: new Date(Date.now() - 30 * DAY) } }, select: { id: true } });
      if (recent) return;
      if (await isOptedOut(i.shop.id, i.to)) return;
      await sendWelcome(i);
    } catch (e: any) {
      console.error("[semafor] welcome e-mail", i.shop.domain, e?.message || e);
    } finally { inFlight.delete(key); }
  })();
}
