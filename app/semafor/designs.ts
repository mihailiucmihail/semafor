// Shared (server + browser): ready-made e-mail designs for recovery e-mails.
// The merchant picks a design and writes only the texts; Semafor fills in the brand (logo / name / colour)
// and the buyer's real products (photo, name, variant, price) at send time.
import { esc } from "./render";

export type DesignId = "elegant" | "minimal" | "modern";
export const DESIGNS: Array<{ id: DesignId; name: string; desc: string }> = [
  { id: "elegant", name: "Elegant", desc: "Fundal crem, titluri serif, poză mare a produsului — pentru modă, genți, bijuterii." },
  { id: "minimal", name: "Minimal", desc: "Alb, curat, multă respirație — merge cu orice magazin." },
  { id: "modern", name: "Modern", desc: "Bandă colorată cu logo, poză pe toată lățimea, buton rotunjit." },
];
export const isDesign = (d: unknown): d is DesignId => d === "elegant" || d === "minimal" || d === "modern";

export type Copy = { greeting: string; heading: string; text: string; button: string; note: string; discount?: string };
export type Brand = { name: string; tagline?: string; logoUrl?: string; accent?: string };
export type Item = { title: string; qty: number; image?: string | null; variant?: string | null; price?: string | null };

type Look = {
  page: string; card: string; border: string; ink: string; muted: string; accent: string; line: string;
  head: string; body: string; radius: string; btnRadius: string; discBg: string; discBorder: string;
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

function look(d: DesignId, accent?: string): Look {
  const a = /^#[0-9a-f]{3,8}$/i.test(accent || "") ? accent! : "";
  if (d === "minimal") return { page: "#ffffff", card: "#ffffff", border: "#ececec", ink: "#141414", muted: "#7a7a7a", accent: a || "#141414", line: "#ededed", head: SANS, body: SANS, radius: "0", btnRadius: "6px", discBg: "#f6f6f6", discBorder: "#dcdcdc" };
  if (d === "modern") return { page: "#eef0f2", card: "#ffffff", border: "#e3e6ea", ink: "#16202b", muted: "#6b7684", accent: a || "#1f3a5f", line: "#e9ecef", head: SANS, body: SANS, radius: "14px", btnRadius: "999px", discBg: "#f3f6fa", discBorder: a || "#1f3a5f" };
  return { page: "#f3eee6", card: "#fffdf9", border: "#e6ddd1", ink: "#2a1a12", muted: "#8a7662", accent: a || "#2a1a12", line: "#eee3d6", head: SERIF, body: SANS, radius: "0", btnRadius: "0", discBg: "#faf3e6", discBorder: "#b8924f" };
}

/** Shopify CDN images can be resized with ?width= */
export function sized(url: string, w: number) {
  try {
    const u = new URL(url);
    if (/(^|\.)shopify(cdn)?\.com$|cdn\.shopify\.com$/.test(u.hostname)) { u.searchParams.set("width", String(w)); return u.toString(); }
    return url;
  } catch { return url; }
}

/** Escape merchant text but keep {{placeholders}}; new lines become <br>. */
const txt = (s: string) => esc(s || "").replace(/&lt;(\/?)(b|i|strong|em|br)&gt;/gi, "<$1$2>").replace(/\n/g, "<br>");

function header(d: DesignId, L: Look, b: Brand) {
  const name = esc(b.name || "");
  const tag = b.tagline ? esc(b.tagline) : "";
  const onBand = d === "modern";
  const color = onBand ? "#ffffff" : L.ink;
  const logo = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" alt="${name}" height="44" style="display:inline-block;height:44px;max-width:220px;border:0">`
    : d === "elegant"
      ? `<div style="font-family:${SERIF};font-size:30px;letter-spacing:.14em;color:${color}">${name}</div>`
      : `<div style="font-family:${SANS};font-size:20px;font-weight:700;letter-spacing:.06em;color:${color}">${name}</div>`;
  const tagHtml = tag ? `<div style="margin-top:4px;font-family:${SANS};font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:${onBand ? "rgba(255,255,255,.8)" : L.muted}">${tag}</div>` : "";
  if (onBand) return `<tr><td style="background:${L.accent};padding:26px 28px;text-align:center;border-radius:${L.radius} ${L.radius} 0 0">${logo}${tagHtml}</td></tr>`;
  return `<tr><td style="padding:30px 32px 8px;text-align:center">${logo}${tagHtml}</td></tr>`;
}

/** The buyer's products: the first one big (photo + name + variant + price), the rest as small rows. */
export function productBlock(d: DesignId, items: Item[], accent?: string) {
  if (!items.length) return "";
  const L = look(d, accent);
  const [first, ...rest] = items;
  const meta = (i: Item) => [i.variant && i.variant !== "Default Title" ? esc(i.variant) : "", i.qty > 1 ? `× ${i.qty}` : ""].filter(Boolean).join(" · ");
  const full = d === "modern";
  const img = first.image
    ? `<img src="${esc(sized(first.image, 1000))}" alt="${esc(first.title)}" width="${full ? 560 : 496}" style="display:block;width:100%;max-width:${full ? 560 : 496}px;height:auto;border:0;${d === "modern" ? "" : `border:1px solid ${L.line};`}">`
    : "";
  const hero = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 6px">
${img ? `<tr><td style="padding:0">${img}</td></tr>` : ""}
<tr><td style="padding:14px 0 4px;${d === "minimal" ? "" : "text-align:center;"}font-family:${L.head};font-size:${d === "elegant" ? "20px" : "17px"};${d === "elegant" ? "letter-spacing:.04em;" : "font-weight:600;"}color:${L.ink}">${esc(first.title)}</td></tr>
${meta(first) || first.price ? `<tr><td style="padding:0 0 4px;${d === "minimal" ? "" : "text-align:center;"}font-family:${SANS};font-size:13px;color:${L.muted}">${[meta(first), first.price ? `<span style="color:${L.ink};font-weight:600">${esc(first.price)}</span>` : ""].filter(Boolean).join(" &nbsp;·&nbsp; ")}</td></tr>` : ""}
</table>`;
  const rows = rest.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 4px;border-top:1px solid ${L.line}">${rest.map((i) => `<tr>
<td width="68" style="padding:10px 0;border-bottom:1px solid ${L.line}">${i.image ? `<img src="${esc(sized(i.image, 160))}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border:0">` : ""}</td>
<td style="padding:10px 0 10px 10px;border-bottom:1px solid ${L.line};font-family:${SANS};font-size:14px;color:${L.ink}">${esc(i.title)}${meta(i) ? `<div style="font-size:12px;color:${L.muted}">${meta(i)}</div>` : ""}</td>
<td align="right" style="padding:10px 0;border-bottom:1px solid ${L.line};font-family:${SANS};font-size:14px;color:${L.ink};white-space:nowrap">${i.price ? esc(i.price) : ""}</td></tr>`).join("")}</table>`
    : "";
  return hero + rows;
}

/**
 * Full e-mail HTML for a design. The result still contains {{placeholders}} (first_name, recovery_url,
 * discount_code, valid_until, total, shop_name, product_block …) that render() fills per buyer.
 */
export function buildEmail(d: DesignId, c: Copy, b: Brand) {
  const L = look(d, b.accent);
  const pad = d === "modern" ? "26px 28px 6px" : "18px 32px 6px";
  const btn = `<a href="{{recovery_url}}" style="display:inline-block;background:${L.accent};color:#ffffff;text-decoration:none;padding:15px 30px;font-family:${SANS};font-size:13px;font-weight:600;letter-spacing:${d === "elegant" ? ".16em" : ".06em"};text-transform:${d === "minimal" ? "none" : "uppercase"};border-radius:${L.btnRadius}">${txt(c.button)}</a>`;
  const disc = c.discount
    ? `{{#discount}}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td style="padding:16px;background:${L.discBg};border:1px dashed ${L.discBorder};border-radius:${d === "modern" ? "10px" : "0"};text-align:center;font-family:${SANS};font-size:14px;color:${L.ink}">${txt(c.discount)}<div style="margin-top:8px;font-family:${d === "elegant" ? SERIF : SANS};font-size:24px;font-weight:${d === "elegant" ? "400" : "700"};letter-spacing:.14em;color:${L.accent}">{{discount_code}}</div></td></tr></table>{{/discount}}`
    : "";
  const align = d === "minimal" ? "left" : "center";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${L.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${L.page};padding:28px 10px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${d === "modern" ? 560 : 560}px;background:${L.card};border:1px solid ${L.border};border-radius:${L.radius}">
${header(d, L, b)}
<tr><td style="padding:${pad};font-family:${L.body};color:${L.ink};font-size:15px;line-height:1.6;text-align:${align}">
${c.greeting ? `<p style="margin:0 0 6px;font-size:15px;color:${L.muted}">${txt(c.greeting)}</p>` : ""}
<h1 style="margin:0 0 12px;font-family:${L.head};font-size:${d === "elegant" ? "26px" : "24px"};line-height:1.25;font-weight:${d === "elegant" ? "400" : "700"};color:${L.ink}">${txt(c.heading)}</h1>
<p style="margin:0 0 14px">${txt(c.text)}</p>
</td></tr>
<tr><td style="padding:0 ${d === "modern" ? "28px" : "32px"}">{{product_block}}</td></tr>
<tr><td style="padding:6px ${d === "modern" ? "28px" : "32px"} 4px;font-family:${L.body};color:${L.ink};font-size:15px;line-height:1.6;text-align:${align}">
${disc}
<p style="margin:22px 0;text-align:center">${btn}</p>
${c.note ? `<p style="margin:0 0 8px;color:${L.muted};font-size:13px">${txt(c.note)}</p>` : ""}
</td></tr>
<tr><td style="padding:18px 32px 26px;font-family:${SANS};color:${L.muted};font-size:11px;text-align:center;border-top:1px solid ${L.line}">{{shop_name}}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Default texts per language and purpose (no product or brand names — those come from the shop). */
export const DEFAULT_COPY: Record<string, { auto1: Copy & { subject: string }; auto2: Copy & { subject: string } }> = {
  ro: {
    auto1: { subject: "Ai uitat ceva în coș?", greeting: "Bună {{first_name}},", heading: "Coșul tău te așteaptă", text: "Nu ai finalizat comanda. Ți-am păstrat produsele alese — cu un clic ajungi înapoi la plată.", button: "Finalizează comanda", note: "Ai întrebări despre produs sau livrare? Răspunde la acest e-mail — te ajutăm cu drag." },
    auto2: { subject: "Doar pentru tine: {{discount_pct}}% reducere", greeting: "Bună {{first_name}},", heading: "Un mic cadou pentru tine", text: "Produsele tale sunt încă în coș. Ca să-ți fie mai ușor să te decizi, îți oferim o reducere personală — se aplică automat la plată.", button: "Folosește reducerea", note: "Codul e de unică folosință și e valabil până la {{valid_until}}.", discount: "<b>{{discount_pct}}% reducere</b> · valabil până la {{valid_until}}" },
  },
  de: {
    auto1: { subject: "Hast du etwas vergessen?", greeting: "Hallo {{first_name}},", heading: "Dein Warenkorb wartet auf dich", text: "Du hast deine Bestellung noch nicht abgeschlossen. Wir haben deine Auswahl für dich gespeichert – mit einem Klick bist du wieder an der Kasse.", button: "Bestellung abschließen", note: "Fragen zum Produkt oder zur Lieferung? Antworte einfach auf diese E-Mail – wir helfen gern." },
    auto2: { subject: "Nur für dich: {{discount_pct}} % Rabatt", greeting: "Hallo {{first_name}},", heading: "Ein kleines Geschenk für dich", text: "Deine Auswahl liegt noch im Warenkorb. Damit dir die Entscheidung leichter fällt, bekommst du einen persönlichen Rabatt – er wird an der Kasse automatisch abgezogen.", button: "Rabatt einlösen", note: "Der Code gilt einmalig und nur bis {{valid_until}}.", discount: "<b>{{discount_pct}} % Rabatt</b> · gültig bis {{valid_until}}" },
  },
  pl: {
    auto1: { subject: "Czy czegoś nie zapomniałaś?", greeting: "Cześć {{first_name}},", heading: "Twój koszyk na Ciebie czeka", text: "Twoje zamówienie nie zostało jeszcze sfinalizowane. Zapisaliśmy wybrane produkty — jednym kliknięciem wrócisz do kasy.", button: "Dokończ zamówienie", note: "Masz pytania o produkt lub dostawę? Po prostu odpisz na tę wiadomość — chętnie pomożemy." },
    auto2: { subject: "Tylko dla Ciebie: {{discount_pct}}% rabatu", greeting: "Cześć {{first_name}},", heading: "Mały prezent dla Ciebie", text: "Twoje produkty wciąż czekają w koszyku. Żeby ułatwić Ci decyzję, mamy dla Ciebie osobisty rabat — zostanie naliczony automatycznie w kasie.", button: "Odbierz rabat", note: "Kod jest jednorazowy i ważny do {{valid_until}}.", discount: "<b>{{discount_pct}}% rabatu</b> · ważny do {{valid_until}}" },
  },
  en: {
    auto1: { subject: "Did you forget something?", greeting: "Hi {{first_name}},", heading: "Your cart is waiting", text: "You haven't finished your order yet. We saved your picks for you — one click takes you back to checkout.", button: "Complete my order", note: "Questions about the product or delivery? Just reply to this e-mail — we're happy to help." },
    auto2: { subject: "Just for you: {{discount_pct}}% off", greeting: "Hi {{first_name}},", heading: "A little gift for you", text: "Your picks are still in your cart. To make the decision easier, here's a personal discount — it's applied automatically at checkout.", button: "Use my discount", note: "The code can be used once and is valid until {{valid_until}}.", discount: "<b>{{discount_pct}}% off</b> · valid until {{valid_until}}" },
  },
};
