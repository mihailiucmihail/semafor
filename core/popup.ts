// Storefront pop-up: default texts per language and the config the theme app embed reads.
// Shared by the admin page (live preview) and the server (metafield the embed reads).
import { DEFAULT_POPUP, POPUP_LANGS, POPUP_DESIGNS, type PopupLang, type PopupSettings, type PopupTexts, type WelcomeTexts } from './settings.ts';

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

/** Pop-up defaults that would promise an e-mail, replaced when the welcome e-mail is OFF. */
export const POPUP_NO_EMAIL_TEXTS: Partial<Record<PopupLang, Partial<PopupTexts>>> = {
  ro: {
    text: 'Abonează-te la noutățile {shop} și primești {pct}% reducere la prima comandă. Codul apare imediat, gata de folosit.',
    note: 'Te poți dezabona oricând.',
    successText: 'Iată codul tău — îl poți folosi chiar acum:',
  },
};

export const WELCOME_KEYS: Array<keyof WelcomeTexts> = ['subject', 'heading', 'text', 'codeLabel', 'button', 'note'];
export const WELCOME_DEFAULT_TEXTS: Record<PopupLang, WelcomeTexts> = {
  ro: {
    subject: 'Reducerea ta de bun venit: {pct}% la {shop}',
    heading: 'Bine ai venit! Iată reducerea ta de {pct}%',
    text: 'Mulțumim că te-ai abonat la noutățile {shop}. Codul de mai jos îți oferă {pct}% reducere la prima comandă — îl poți folosi oricând.',
    codeLabel: 'codul tău de bun venit',
    button: 'Aplică reducerea',
    note: 'Reducerea se aplică automat când apeși butonul. Codul se poate folosi o singură dată.',
  },
  de: {
    subject: 'Dein Willkommensrabatt: {pct} % bei {shop}',
    heading: 'Willkommen! Hier ist dein Rabatt von {pct} %',
    text: 'Schön, dass du die Neuigkeiten von {shop} abonniert hast. Mit dem Code unten erhältst du {pct} % Rabatt auf deine erste Bestellung – einlösbar, wann immer du möchtest.',
    codeLabel: 'dein Willkommenscode',
    button: 'Rabatt anwenden',
    note: 'Mit einem Klick auf den Button wird der Rabatt automatisch angewendet. Der Code ist einmal einlösbar.',
  },
  pl: {
    subject: 'Twój rabat powitalny: {pct}% w {shop}',
    heading: 'Witaj! Oto Twój rabat {pct}%',
    text: 'Dziękujemy za zapis na nowości {shop}. Kod poniżej daje {pct}% rabatu na pierwsze zamówienie — możesz go użyć, kiedy zechcesz.',
    codeLabel: 'Twój kod powitalny',
    button: 'Zastosuj rabat',
    note: 'Rabat zostanie naliczony automatycznie po kliknięciu przycisku. Kod można wykorzystać jeden raz.',
  },
  en: {
    subject: 'Your welcome discount: {pct}% off at {shop}',
    heading: "Welcome! Here's your {pct}% discount",
    text: 'Thanks for subscribing to {shop} news. The code below gives you {pct}% off your first order — use it whenever you like.',
    codeLabel: 'your welcome code',
    button: 'Apply my discount',
    note: 'The discount is applied automatically when you tap the button. The code can be used once.',
  },
};

export function welcomeTexts(p: Pick<PopupSettings, 'welcomeTexts'>, lang: PopupLang): WelcomeTexts {
  return { ...WELCOME_DEFAULT_TEXTS[lang], ...((p.welcomeTexts ?? {})[lang] ?? {}) };
}
export function welcomeOverrides(lang: PopupLang, t: Partial<WelcomeTexts>): Partial<WelcomeTexts> {
  const out: Partial<WelcomeTexts> = {};
  for (const k of WELCOME_KEYS) {
    const v = t[k];
    if (typeof v === 'string' && v !== WELCOME_DEFAULT_TEXTS[lang][k]) out[k] = v.slice(0, 1000);
  }
  return out;
}

/** Default pop-up texts; without the welcome e-mail they don't promise an e-mail. */
export function popupDefaults(lang: PopupLang, welcome = true): PopupTexts {
  return { ...POPUP_DEFAULT_TEXTS[lang], ...(welcome ? {} : POPUP_NO_EMAIL_TEXTS[lang] ?? {}) };
}
/** true when pop-up texts say the code comes by e-mail (warn when the welcome e-mail is off). */
export function promisesEmail(t: Partial<PopupTexts>): boolean {
  return /(pe e-mail|per e-?mail|e-mailem|by e-?mail|to your inbox|ți-am trimis|wysłaliśmy|haben wir dir)/i.test([t.text, t.note, t.successText].filter(Boolean).join(' '));
}

/** Texts of one language as the merchant sees them in the editor (defaults + overrides, placeholders kept). */
export function popupTexts(p: Pick<PopupSettings, 'texts'> & { welcome?: boolean }, lang: PopupLang): PopupTexts {
  return { ...popupDefaults(lang, p.welcome !== false), ...((p.texts ?? {})[lang] ?? {}) };
}

/** Only the fields that differ from the defaults (what is stored). */
/** Only what differs from the defaults (either variant, with or without the welcome e-mail) is stored. */
export function textOverrides(lang: PopupLang, t: Partial<PopupTexts>, welcome = true): Partial<PopupTexts> {
  const out: Partial<PopupTexts> = {};
  const def = popupDefaults(lang, welcome);
  for (const k of POPUP_TEXT_KEYS) {
    const v = t[k];
    if (typeof v === 'string' && v !== def[k] && v !== POPUP_DEFAULT_TEXTS[lang][k] && v !== popupDefaults(lang, false)[k]) out[k] = v.slice(0, 600);
  }
  return out;
}

/** Normalises merchant input (numbers in range, known design, clean code). */
export function cleanPopup(p: Partial<PopupSettings>): PopupSettings {
  const n = (v: unknown, d: number, min: number, max: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };
  const texts: PopupSettings['texts'] = {};
  const welcome = p.welcome !== false;
  for (const l of POPUP_LANGS) { const o = textOverrides(l, (p.texts ?? {})[l] ?? {}, welcome); if (Object.keys(o).length) texts[l] = o; }
  const welcomeTexts: PopupSettings['welcomeTexts'] = {};
  for (const l of POPUP_LANGS) { const o = welcomeOverrides(l, (p.welcomeTexts ?? {})[l] ?? {}); if (Object.keys(o).length) welcomeTexts[l] = o; }
  const img = String(p.imageUrl ?? '').trim();
  return {
    enabled: !!p.enabled,
    mode: p.mode === 'cart' || p.mode === 'site' ? p.mode : 'smart',
    delay: n(p.delay, DEFAULT_POPUP.delay, 0, 300),
    cartDelay: n(p.cartDelay, DEFAULT_POPUP.cartDelay, 0, 120),
    exitIntent: p.exitIntent !== false,
    hideDays: n(p.hideDays, DEFAULT_POPUP.hideDays, 1, 365),
    codeMode: p.codeMode === 'own' ? 'own' : 'auto',
    code: p.codeMode === 'own'
      ? String(p.code ?? DEFAULT_POPUP.code).trim().replace(/\s+/g, '').toUpperCase().slice(0, 60)
      : autoCode(n(p.pct, DEFAULT_POPUP.pct, 1, 100)),
    pct: n(p.pct, DEFAULT_POPUP.pct, 1, 100),
    design: POPUP_DESIGNS.includes(p.design as any) ? (p.design as PopupSettings['design']) : 'classic',
    imageUrl: /^https:\/\//i.test(img) ? img.slice(0, 1000) : '',
    texts,
    welcome,
    welcomeTexts,
    localCodes: cleanLocalCodes(p.localCodes),
  };
}

/** Word for "welcome" per language, used to name the per-language code: BUNVENIT15, WILLKOMMEN15 … */
export const LOCAL_CODE_PREFIX: Record<PopupLang, string> = { ro: 'BUNVENIT', de: 'WILLKOMMEN', pl: 'WITAJ', en: 'WELCOME' };
export const localCodeName = (lang: PopupLang, pct: number) => `${LOCAL_CODE_PREFIX[lang]}${Math.round(pct)}`;

function cleanLocalCodes(m: unknown): Partial<Record<PopupLang, string>> {
  const out: Partial<Record<PopupLang, string>> = {};
  if (m && typeof m === 'object') for (const l of POPUP_LANGS) {
    const v = (m as any)[l];
    if (typeof v === 'string' && /^[A-Z0-9_-]{2,60}$/.test(v)) out[l] = v;
  }
  return out;
}

/** The code a visitor of this language gets (falls back to the main code). */
export const codeForLang = (p: Pick<PopupSettings, 'code' | 'localCodes'>, lang: PopupLang) => p.localCodes?.[lang] || p.code;

/** All codes the pop-up may hand out (attribution). */
export const allPopupCodes = (p: Pick<PopupSettings, 'code' | 'localCodes'>) => [...new Set([p.code, ...Object.values(p.localCodes ?? {})].filter(Boolean) as string[])];

/** Code Semafor creates for a percentage (auto mode). */
export const autoCode = (pct: number) => `WELCOME${Math.round(pct)}`;
export const PCT_CHOICES = [5, 10, 15, 20, 25];

export type PopupConfig = {
  v: 1; enabled: boolean; mode: 'smart' | 'site' | 'cart'; delay: number; cartDelay: number; exitIntent: boolean; hideDays: number;
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
