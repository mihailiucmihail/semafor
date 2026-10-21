// Welcome e-mail to the merchant right after a real store installs Semafor (the text Mihai approved on 21 Oct 2026).
// Romanian for Romania / Moldova, English everywhere else. One mail per store, ever (deduped in AppKv).
// Replies go to the owner's own inbox.
import db from "../db.server";

const OWNER_REPLY_TO = process.env.MERCHANT_WELCOME_REPLY_TO || "mihailiucmihail@gmail.com";
/** Stores Mihai already welcomed by hand before this was automated. */
const ALREADY_WELCOMED = new Set(["hf7525-3h.myshopify.com"]);
const esc = (s: string) => s.replace(/[<>&"]/g, "");

type Lang = "ro" | "en";

const TEXT: Record<Lang, { subject: string; paras: string[]; review: string; thanks: string }> = {
  ro: {
    subject: "Bun venit în rețeaua Semafor!",
    paras: [
      "Mulțumim că ați instalat Semafor pe {shop}!",
      "Aveți deja prețul de lansare: în aplicație, la Planuri, Basic costă 2,49 $/lună și Pro 7,49 $/lună — jumătate de preț, pentru totdeauna, dacă vă abonați până pe 31 decembrie 2026.",
      "Am ales cel mai mic preț pe care ni-l putem permite dintr-un motiv simplu: vrem ca orice magazin să poată folosi Semafor. Toți cunoaștem clienții care comandă de zeci de ori și nu ridică niciodată coletul. Pentru ei e doar un click, pentru noi înseamnă transport plătit dus-întors, ambalaj și timp pierdut.",
      "Semafor leagă între ele informațiile de la toate magazinele care au aplicația instalată. Clienții care refuză des coletele sunt semnalați, iar dumneavoastră — ca fiecare magazin din rețea — veți vedea asta înainte să trimiteți comanda. Decizia rămâne mereu a dumneavoastră: riscați și trimiteți, cereți plata în avans sau ascundeți plata ramburs pentru acel client. Fiecare decide pentru el, dar decide informat. Totul circulă criptat, deci niciun magazin nu vede datele personale ale clienților altui magazin. Cu cât suntem mai mulți în rețea, cu atât informația e mai completă pentru fiecare dintre noi.",
    ],
    review: "Dacă Semafor vă ajută, o recenzie sinceră în Shopify App Store ar conta enorm pentru noi: {link}. Așa ne găsesc și alte magazine, iar rețeaua devine tot mai utilă pentru toți.",
    thanks: "Vă mulțumim că sunteți alături de noi!",
  },
  en: {
    subject: "Welcome to the Semafor network!",
    paras: [
      "Thank you for installing Semafor on {shop}!",
      "You already have the launch price: in the app, under Plans, Basic is $2.49/month and Pro is $7.49/month — half price, forever, if you subscribe before 31 December 2026.",
      "We chose the lowest price we can afford for one simple reason: we want every store to be able to use Semafor. We all know the customers who order again and again and never collect the parcel. For them it is just a click; for us it means shipping paid both ways, packaging and lost time.",
      "Semafor connects the information from every store that has the app installed. Customers who often refuse parcels are flagged, and you — like every store in the network — will see it before you ship the order. The decision is always yours: take the risk and ship, ask for prepayment, or hide cash on delivery for that customer. Everyone decides for themselves, but decides informed. Everything travels encrypted, so no store ever sees another store's customers' personal data. The more of us in the network, the more complete the information is for each of us.",
    ],
    review: "If Semafor helps you, an honest review on the Shopify App Store would mean a lot to us: {link}. That is how other stores find us, and the network becomes more useful for everyone.",
    thanks: "Thank you for being with us!",
  },
};

export const merchantLang = (country: string): Lang => (country === "RO" || country === "MD" ? "ro" : "en");

export function merchantWelcomeHtml(lang: Lang, shopName: string) {
  const t = TEXT[lang];
  const link = "https://apps.shopify.com/semafor#reviews";
  const p = (x: string) => `<p style="margin:0 0 14px">${x}</p>`;
  const body = [
    p(lang === "ro" ? "Bună ziua," : "Hello,"),
    ...t.paras.map((x) => p(x.replace("{shop}", `<b>${esc(shopName)}</b>`))),
    p(t.review.replace("{link}", `<a href="${link}" style="color:#12271D">${link}</a>`)),
    p(t.thanks),
    `<p style="margin:18px 0 0">Mihai Mihailiuc<br><span style="color:#616161">Kastel Labs · <a href="https://kastellabs.com" style="color:#616161">kastellabs.com</a></span></p>`,
  ].join("\n");
  return { subject: t.subject, html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px">${body}</div>` };
}

/** Sends the welcome once per store. Never throws. */
export async function sendMerchantWelcome(domain: string, info: { name: string; country: string; email: string } | null) {
  try {
    if (!info?.email || !process.env.RESEND_API_KEY || process.env.MERCHANT_WELCOME === "off") return;
    if (ALREADY_WELCOMED.has(domain)) return;
    const fresh = await db.appKv.create({ data: { key: `merchant-welcome:${domain}`, value: new Date().toISOString() } }).then(() => true, () => false);
    if (!fresh) return;
    const { subject, html } = merchantWelcomeHtml(merchantLang(info.country), info.name || domain);
    const { sendMail } = await import("./recovery.server");
    const from = `mihai@${process.env.SEMAFOR_MAIL_DOMAIN || "semafor.kastelmail.com"}`;
    await sendMail({ to: info.email, subject, html, fromName: merchantLang(info.country) === "ro" ? "Mihai de la Semafor" : "Mihai from Semafor", fromEmail: from, replyTo: OWNER_REPLY_TO });
  } catch (e) { console.error("[semafor] merchant welcome", e); }
}
