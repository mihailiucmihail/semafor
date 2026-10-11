// Storefront pop-up: default texts per language and the config the theme app embed reads.
// Shared by the admin page (live preview) and the server (metafield the embed reads).
import { DEFAULT_POPUP, POPUP_LANGS, POPUP_DESIGNS, type PopupLang, type PopupSettings, type PopupTexts } from './settings.ts';

export const POPUP_TEXT_KEYS: Array<keyof PopupTexts> = [
  'bigLabel', 'bigSub', 'eyebrow', 'heading', 'text', 'placeholder', 'button', 'note', 'decline',
  'successEyebrow', 'successHeading', 'successText', 'successButton', 'successNote',
  'copy', 'copied', 'close', 'invalid', 'failed',
];

/** Defaults. RO = the texts of the original MIHAILIUC theme pop-up; {shop} = shop name, {pct} = discount %. */
export const POPUP_DEFAULT_TEXTS: Record<PopupLang, PopupTexts> = {
  ro: {
    bigLabel: '-{pct}%', bigSub: 'la prima comandă',
    eyebrow: 'Bine ai venit',
    heading: 'Un început frumos merită un gest pe măsură.',
    text: 'Abonează-te la noutățile {shop} și primești {pct}% reducere la prima comandă. Codul îl primești pe e-mail, gata de folosit.',
    placeholder: 'Adresa ta de e-mail',
    button: 'Primesc reducerea',
    note: 'Codul și linkul ajung pe e-mail imediat după abonare. Te poți dezabona oricând.',
    decline: 'Nu acum, mulțumesc',
    successEyebrow: 'Abonare confirmată',
    successHeading: 'Mulțumim. Reducerea ta este pregătită.',
    successText: 'Ți-am trimis codul și linkul pe e-mail, ca să le ai la îndemână oricând. Îl poți folosi și chiar acum:',
    successButton: 'Aplică reducerea și descoperă colecția',
    successNote: 'Reducerea se aplică automat la finalizarea comenzii.',
    copy: 'Copiază', copied: 'Copiat', close: 'Închide',
    invalid: 'Introdu o adresă de e-mail validă.',
    failed: 'Ceva n-a mers. Încearcă din nou.',
  },
  de: {
    bigLabel: '-{pct}%', bigSub: 'auf deine erste Bestellung',
    eyebrow: 'Willkommen',
    heading: 'Ein schöner Anfang verdient eine besondere Geste.',
    text: 'Abonniere die Neuigkeiten von {shop} und erhalte {pct} % Rabatt auf deine erste Bestellung. Deinen Code bekommst du sofort – direkt einsatzbereit.',
    placeholder: 'Deine E-Mail-Adresse',
    button: 'Rabatt sichern',
    note: 'Mit der Anmeldung erhältst du Neuigkeiten und Angebote per E-Mail. Abmeldung jederzeit möglich.',
    decline: 'Nein danke, jetzt nicht',
    successEyebrow: 'Anmeldung bestätigt',
    successHeading: 'Danke! Dein Rabatt ist bereit.',
    successText: 'Hier ist dein persönlicher Code – du kannst ihn sofort verwenden:',
    successButton: 'Rabatt anwenden und Kollektion entdecken',
    successNote: 'Der Rabatt wird an der Kasse automatisch abgezogen.',
    copy: 'Kopieren', copied: 'Kopiert', close: 'Schließen',
    invalid: 'Bitte gib eine gültige E-Mail-Adresse ein.',
    failed: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
  },
  pl: {
    bigLabel: '-{pct}%', bigSub: 'na pierwsze zamówienie',
    eyebrow: 'Witaj',
    heading: 'Piękny początek zasługuje na wyjątkowy gest.',
    text: 'Zapisz się na nowości {shop} i odbierz {pct}% rabatu na pierwsze zamówienie. Kod otrzymasz od razu – gotowy do użycia.',
    placeholder: 'Twój adres e-mail',
    button: 'Odbieram rabat',
    note: 'Zapisując się, otrzymasz nowości i oferty e-mailem. Możesz wypisać się w każdej chwili.',
    decline: 'Nie teraz, dziękuję',
    successEyebrow: 'Zapis potwierdzony',
    successHeading: 'Dziękujemy. Twój rabat czeka.',
    successText: 'Oto Twój kod – możesz użyć go od razu:',
    successButton: 'Zastosuj rabat i odkryj kolekcję',
    successNote: 'Rabat zostanie naliczony automatycznie przy składaniu zamówienia.',
    copy: 'Kopiuj', copied: 'Skopiowano', close: 'Zamknij',
    invalid: 'Podaj prawidłowy adres e-mail.',
    failed: 'Coś poszło nie tak. Spróbuj ponownie.',
  },
  en: {
    bigLabel: '-{pct}%', bigSub: 'on your first order',
    eyebrow: 'Welcome',
    heading: 'A beautiful beginning deserves a special welcome.',
    text: 'Join the {shop} newsletter and get {pct}% off your first order. Your code appears instantly, ready to use.',
    placeholder: 'Your e-mail address',
    button: 'Get my discount',
    note: "By subscribing you'll receive news and offers by e-mail. Unsubscribe anytime.",
    decline: 'Not now, thanks',
    successEyebrow: "You're subscribed",
    successHeading: 'Thank you. Your discount is ready.',
    successText: 'Here is your code — you can use it right away:',
    successButton: 'Apply the discount and shop the collection',
    successNote: 'The discount is applied automatically at checkout.',
    copy: 'Copy', copied: 'Copied', close: 'Close',
    invalid: 'Please enter a valid e-mail address.',
    failed: 'Something went wrong. Please try again.',
  },
};

/** Texts of one language as the merchant sees them in the editor (defaults + overrides, placeholders kept). */
export function popupTexts(p: Pick<PopupSettings, 'texts'>, lang: PopupLang): PopupTexts {
  return { ...POPUP_DEFAULT_TEXTS[lang], ...((p.texts ?? {})[lang] ?? {}) };
}

/** Only the fields that differ from the defaults (what is stored). */
export function textOverrides(lang: PopupLang, t: Partial<PopupTexts>): Partial<PopupTexts> {
  const out: Partial<PopupTexts> = {};
  for (const k of POPUP_TEXT_KEYS) {
    const v = t[k];
    if (typeof v === 'string' && v !== POPUP_DEFAULT_TEXTS[lang][k]) out[k] = v.slice(0, 600);
  }
  return out;
}

/** Normalises merchant input (numbers in range, known design, clean code). */
export function cleanPopup(p: Partial<PopupSettings>): PopupSettings {
  const n = (v: unknown, d: number, min: number, max: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };
  const texts: PopupSettings['texts'] = {};
  for (const l of POPUP_LANGS) { const o = textOverrides(l, (p.texts ?? {})[l] ?? {}); if (Object.keys(o).length) texts[l] = o; }
  const img = String(p.imageUrl ?? '').trim();
  return {
    enabled: !!p.enabled,
    mode: p.mode === 'cart' ? 'cart' : 'site',
    delay: n(p.delay, DEFAULT_POPUP.delay, 0, 300),
    cartDelay: n(p.cartDelay, DEFAULT_POPUP.cartDelay, 0, 120),
    exitIntent: p.exitIntent !== false,
    hideDays: n(p.hideDays, DEFAULT_POPUP.hideDays, 1, 365),
    code: String(p.code ?? DEFAULT_POPUP.code).trim().replace(/\s+/g, '').toUpperCase().slice(0, 60),
    pct: n(p.pct, DEFAULT_POPUP.pct, 1, 100),
    design: POPUP_DESIGNS.includes(p.design as any) ? (p.design as PopupSettings['design']) : 'classic',
    imageUrl: /^https:\/\//i.test(img) ? img.slice(0, 1000) : '',
    texts,
  };
}

export type PopupConfig = {
  v: 1; enabled: boolean; mode: 'site' | 'cart'; delay: number; cartDelay: number; exitIntent: boolean; hideDays: number;
  code: string; design: string; image: string; texts: Record<PopupLang, PopupTexts>;
};

/** What the storefront embed receives (texts resolved for every language, placeholders filled). */
export function buildPopupConfig(p: PopupSettings, shopName: string): PopupConfig {
  const fill = (s: string) => s.replace(/\{shop\}/g, shopName || '').replace(/\{pct\}/g, String(p.pct)).replace(/\s{2,}/g, ' ').trim();
  const texts = {} as Record<PopupLang, PopupTexts>;
  for (const l of POPUP_LANGS) {
    const t = popupTexts(p, l);
    texts[l] = Object.fromEntries(POPUP_TEXT_KEYS.map((k) => [k, fill(t[k])])) as unknown as PopupTexts;
  }
  return { v: 1, enabled: p.enabled, mode: p.mode, delay: p.delay, cartDelay: p.cartDelay, exitIntent: p.exitIntent, hideDays: p.hideDays, code: p.code, design: p.design, image: p.imageUrl, texts };
}
