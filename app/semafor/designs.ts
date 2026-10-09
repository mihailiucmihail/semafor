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

export type Copy = { greeting: string; heading: string; text: string; button: string; note: string; discount?: string; /** shown when the cart already had a discount */ existing?: string };
export type Brand = { name: string; tagline?: string; logoUrl?: string; accent?: string };
export type Item = { title: string; qty: number; image?: string | null; variant?: string | null; variantId?: string | null; price?: string | null; /** full price before the discount, shown struck through */ oldPrice?: string | null };

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
${meta(first) || first.price ? `<tr><td style="padding:0 0 4px;${d === "minimal" ? "" : "text-align:center;"}font-family:${SANS};font-size:13px;color:${L.muted}">${[meta(first), first.price ? `${first.oldPrice ? `<s style="color:${L.muted};font-weight:400">${esc(first.oldPrice)}</s>&nbsp; ` : ""}<span style="color:${L.ink};font-weight:600">${esc(first.price)}</span>` : ""].filter(Boolean).join(" &nbsp;·&nbsp; ")}</td></tr>` : ""}
</table>`;
  const rows = rest.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 4px;border-top:1px solid ${L.line}">${rest.map((i) => `<tr>
<td width="68" style="padding:10px 0;border-bottom:1px solid ${L.line}">${i.image ? `<img src="${esc(sized(i.image, 160))}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border:0">` : ""}</td>
<td style="padding:10px 0 10px 10px;border-bottom:1px solid ${L.line};font-family:${SANS};font-size:14px;color:${L.ink}">${esc(i.title)}${meta(i) ? `<div style="font-size:12px;color:${L.muted}">${meta(i)}</div>` : ""}</td>
<td align="right" style="padding:10px 0;border-bottom:1px solid ${L.line};font-family:${SANS};font-size:14px;color:${L.ink};white-space:nowrap">${i.oldPrice ? `<s style="color:${L.muted}">${esc(i.oldPrice)}</s><br>` : ""}${i.price ? esc(i.price) : ""}</td></tr>`).join("")}</table>`
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
  // Discount: quiet, editorial — a big number between two hairlines, the code in a thin frame. No coupon look.
  // Old default texts started with "<b>{{discount_pct}}% …</b> · " — the big number already says that.
  const discText = (c.discount || "").replace(/^\s*<b>[^<]*\{\{discount_pct\}\}[^<]*<\/b>\s*·?\s*/i, "");
  const numFont = d === "elegant" ? SERIF : SANS;
  const disc = c.discount
    ? `{{#discount}}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;border-top:1px solid ${L.line};border-bottom:1px solid ${L.line}"><tr><td style="padding:26px 8px 24px;text-align:center">
<div style="font-family:${numFont};font-size:46px;line-height:1;font-weight:${d === "elegant" ? "400" : "300"};letter-spacing:.02em;color:${L.ink}">{{discount_pct}}%</div>
${discText ? `<div style="margin:10px auto 0;max-width:360px;font-family:${SANS};font-size:12px;line-height:1.6;letter-spacing:.06em;color:${L.muted}">${txt(discText)}</div>` : ""}
<div style="margin-top:16px"><span style="display:inline-block;padding:9px 18px;border:1px solid ${L.ink};border-radius:${d === "modern" ? "999px" : "0"};font-family:${SANS};font-size:12px;letter-spacing:.24em;color:${L.ink}">{{discount_code}}</span></div>
</td></tr></table>{{/discount}}`
    : "";
  const existing = c.existing
    ? `{{#cart_discount}}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;border-top:1px solid ${L.line};border-bottom:1px solid ${L.line}"><tr><td style="padding:18px 8px;text-align:center;font-family:${d === "elegant" ? SERIF : SANS};font-size:${d === "elegant" ? "17px" : "15px"};line-height:1.5;color:${L.ink}">${txt(c.existing)}</td></tr></table>{{/cart_discount}}`
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
${existing}${disc}
<p style="margin:22px 0;text-align:center">${btn}</p>
${c.note ? `<p style="margin:0 0 8px;color:${L.muted};font-size:13px">${txt(c.note)}</p>` : ""}
</td></tr>
<tr><td style="padding:20px 32px 26px;font-family:${SANS};color:${L.muted};font-size:12px;line-height:1.7;text-align:center;border-top:1px solid ${L.line}">
<div style="letter-spacing:.08em">{{shop_name}}</div>
<div style="margin-top:6px">{{unsubscribe_why}}</div>
<div style="margin-top:6px"><a href="{{unsubscribe_url}}" style="color:${L.ink};text-decoration:underline">{{unsubscribe_label}}</a></div>
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Default texts per language and purpose (no brand names — those come from the shop; the product title is filled in). */
type C = Copy & { subject: string };
export const DEFAULT_COPY: Record<string, { auto1: C; auto2: C; auto3: C }> = {
  ro: {
    auto1: { subject: "Ți-am păstrat alegerea", greeting: "Bună {{first_name}},", heading: "Te așteaptă în coș", text: "Ai fost la un pas. Produsul ales te așteaptă exact cum l-ai lăsat — cu un singur clic revii la comandă.", button: "Revino la comandă", note: "Ai o întrebare despre culoare, mărime sau livrare? Răspunde direct la acest e-mail — îți scriem personal." },
    auto2: { subject: "{{product_title}} se epuizează repede", greeting: "Bună {{first_name}},", heading: "Una dintre cele mai căutate culori", text: "{{product_title}} este printre preferatele clientelor noastre în aceste zile, iar stocul scade repede. Când se epuizează, revenirea în stoc durează destul de mult — nu am vrea să rămâi fără ea.", existing: "Vestea bună: reducerea ta de {{cart_discount_pct}}% este încă activă în coș.", discount: "reducere personală, doar pentru tine · valabilă până la {{valid_until}}", button: "Finalizează comanda", note: "Reducerea se aplică automat când apeși butonul." },
    auto3: { subject: "Ultima șansă: {{discount_pct}}% reducere, doar azi", greeting: "Bună {{first_name}},", heading: "O ultimă ofertă, doar pentru azi", text: "Multe cliente au profitat deja de reducerea de {{discount_pct}}% și și-au comandat-o. {{product_title}} se termină foarte repede, iar până revine în stoc poate trece destul de mult timp. Dacă îți place, acum e momentul.", discount: "doar azi · valabilă până la {{valid_until}}", button: "Comandă cu {{discount_pct}}% reducere", note: "La miezul nopții codul expiră." },
  },
  de: {
    auto1: { subject: "Wir haben deine Auswahl für dich reserviert", greeting: "Hallo {{first_name}},", heading: "Sie wartet in deinem Warenkorb", text: "Du warst nur einen Schritt entfernt. Deine Auswahl liegt genau so im Warenkorb, wie du sie verlassen hast – mit einem Klick bist du zurück an der Kasse.", button: "Zurück zur Bestellung", note: "Fragen zu Farbe, Größe oder Lieferung? Antworte einfach auf diese E-Mail – wir melden uns persönlich." },
    auto2: { subject: "{{product_title}} ist schnell vergriffen", greeting: "Hallo {{first_name}},", heading: "Eine unserer gefragtesten Farben", text: "{{product_title}} gehört gerade zu den Lieblingen unserer Kundinnen, und der Bestand schrumpft schnell. Ist sie ausverkauft, dauert es eine ganze Weile, bis sie wieder da ist – wir möchten nicht, dass du sie verpasst.", existing: "Die gute Nachricht: Dein Rabatt von {{cart_discount_pct}} % ist in deinem Warenkorb noch aktiv.", discount: "dein persönlicher Rabatt · gültig bis {{valid_until}}", button: "Bestellung abschließen", note: "Der Rabatt wird mit einem Klick auf den Button automatisch angewendet." },
    auto3: { subject: "Letzte Chance: {{discount_pct}} % Rabatt, nur heute", greeting: "Hallo {{first_name}},", heading: "Ein letztes Angebot – nur heute", text: "Viele Kundinnen haben die {{discount_pct}} % bereits genutzt und bestellt. {{product_title}} ist sehr schnell vergriffen, und bis sie wieder auf Lager ist, kann einige Zeit vergehen. Wenn sie dir gefällt, ist jetzt der Moment.", discount: "nur heute · gültig bis {{valid_until}}", button: "Mit {{discount_pct}} % bestellen", note: "Um Mitternacht läuft der Code ab." },
  },
  pl: {
    auto1: { subject: "Zachowaliśmy Twój wybór", greeting: "Cześć {{first_name}},", heading: "Czeka na Ciebie w koszyku", text: "Byłaś o krok. Twój wybór czeka w koszyku dokładnie tak, jak go zostawiłaś — jednym kliknięciem wrócisz do zamówienia.", button: "Wróć do zamówienia", note: "Masz pytanie o kolor, rozmiar lub dostawę? Odpisz na tę wiadomość — odpowiemy osobiście." },
    auto2: { subject: "{{product_title}} szybko się wyprzedaje", greeting: "Cześć {{first_name}},", heading: "Jeden z najchętniej wybieranych kolorów", text: "{{product_title}} to teraz jeden z ulubieńców naszych klientek, a zapas szybko maleje. Gdy się wyprzeda, powrót do sprzedaży trwa dość długo — nie chcemy, żeby Cię ominął.", existing: "Dobra wiadomość: Twój rabat {{cart_discount_pct}}% jest wciąż aktywny w koszyku.", discount: "Twój osobisty rabat · ważny do {{valid_until}}", button: "Dokończ zamówienie", note: "Rabat zostanie naliczony automatycznie po kliknięciu przycisku." },
    auto3: { subject: "Ostatnia szansa: {{discount_pct}}% rabatu, tylko dziś", greeting: "Cześć {{first_name}},", heading: "Ostatnia oferta — tylko dziś", text: "Wiele klientek skorzystało już z rabatu {{discount_pct}}% i złożyło zamówienie. {{product_title}} wyprzedaje się bardzo szybko, a na ponowną dostawę trzeba będzie poczekać dłuższy czas. Jeśli Ci się podoba, to właściwy moment.", discount: "tylko dziś · ważny do {{valid_until}}", button: "Zamów z rabatem {{discount_pct}}%", note: "O północy kod wygasa." },
  },
  en: {
    auto1: { subject: "We saved your pick for you", greeting: "Hi {{first_name}},", heading: "It's waiting in your cart", text: "You were one step away. Your pick is in your cart exactly as you left it — one click takes you back to checkout.", button: "Back to my order", note: "A question about colour, size or delivery? Just reply to this e-mail — we'll answer personally." },
    auto2: { subject: "{{product_title}} is selling fast", greeting: "Hi {{first_name}},", heading: "One of our most wanted colours", text: "{{product_title}} is one of our customers' favourites right now and stock is going fast. Once it sells out, it takes quite a while to come back — we'd hate for you to miss it.", existing: "Good news: your {{cart_discount_pct}}% discount is still active in your cart.", discount: "your personal discount · valid until {{valid_until}}", button: "Complete my order", note: "The discount is applied automatically when you tap the button." },
    auto3: { subject: "Last chance: {{discount_pct}}% off, today only", greeting: "Hi {{first_name}},", heading: "One last offer — today only", text: "Many customers have already used the {{discount_pct}}% and placed their order. {{product_title}} sells out very fast, and it can take quite some time before it's back in stock. If you love it, now is the moment.", discount: "today only · valid until {{valid_until}}", button: "Order with {{discount_pct}}% off", note: "The code expires at midnight." },
  },
};
