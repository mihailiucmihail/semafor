// Refuz — shop settings and the decisions fixed on 2026-10-06.
export interface ShopSettings {
  thresholds: { block: number; warn: number };
  /** What happens to a yellow order. Decision: default "tag" (mark only). */
  yellowAction: 'tag' | 'prepaid' | 'block';
  /** Cancel red orders automatically (off by default). */
  cancelRed: boolean;
  /** Share with / see the network. */
  shareNetwork: boolean;
  /** Reasons that go to the network after ONE entry (chargeback, abuse). refuz_colet only after the 2nd. */
  networkImmediate: Array<'chargeback' | 'return_fraud' | 'abuse'>;
  /** Abandoned-checkout recovery e-mails (sent by Semafor through Resend). */
  recovery: RecoverySettings;
  /** Language of the admin pages; null = automatic (see app/i18n.server.ts). */
  uiLang?: 'en' | 'ro' | null;
  /** Last Shopify admin locale seen in the embedded-app URL (automatic language only). */
  adminLocale?: string | null;
  /** Shop country from Shopify (billing address), used only for the automatic language. */
  shopCountry?: string | null;
  /** Storefront pop-up (e-mail capture with a discount) — see core/popup.ts. */
  popup: PopupSettings;
  /** Last time the storefront pop-up embed pinged Semafor (ISO) — tells the admin page the embed is on. */
  popupSeenAt?: string | null;
}

export type PopupDesign = 'classic' | 'winter' | 'spring' | 'summer' | 'autumn';
export type PopupLang = 'ro' | 'de' | 'pl' | 'en';
export const POPUP_LANGS: PopupLang[] = ['ro', 'de', 'pl', 'en'];
export const POPUP_DESIGNS: PopupDesign[] = ['classic', 'winter', 'spring', 'summer', 'autumn'];

/** Texts of the pop-up in one storefront language ({shop} = shop name, {pct} = discount %). */
export interface PopupTexts {
  bigLabel: string; bigSub: string;
  eyebrow: string; heading: string; text: string; placeholder: string; button: string; note: string; decline: string;
  successEyebrow: string; successHeading: string; successText: string; successButton: string; successNote: string;
  copy: string; copied: string; close: string; invalid: string; failed: string;
}

export interface PopupSettings {
  enabled: boolean;
  /** "smart" (default): any page after `delay` s for newcomers, plus a re-offer when an unknown visitor opens a cart
   *  without a discount (`cartDelay` s, once per session, even after dismissing) ·
   *  "site": any page after `delay` s · "cart": only with items in the cart, `cartDelay` s after add-to-cart / cart open */
  mode: 'smart' | 'site' | 'cart';
  delay: number;
  cartDelay: number;
  /** Also open on exit intent (desktop, mouse leaving to the top) when the cart has items — once per page. */
  exitIntent: boolean;
  /** Days the pop-up stays hidden after "no thanks" / close. */
  hideDays: number;
  /** "auto": Semafor creates / keeps the code WELCOME<pct> in Shopify · "own": the merchant's existing `code` */
  codeMode: 'auto' | 'own';
  code: string;
  pct: number;
  design: PopupDesign;
  imageUrl: string;
  /** Merchant overrides per storefront language (only fields that differ from the defaults). */
  texts: Partial<Record<PopupLang, Partial<PopupTexts>>>;
}

export const DEFAULT_POPUP: PopupSettings = {
  enabled: false, mode: 'smart', delay: 10, cartDelay: 4, exitIntent: true, hideDays: 14,
  codeMode: 'auto', code: 'WELCOME15', pct: 15, design: 'classic', imageUrl: '', texts: {},
};

export interface RecoverySettings {
  enabled: boolean;          // automatic e-mails on/off
  first: boolean;            // send the 1st reminder (~1 h after leaving); false = start with the next-day e-mail
  delay1Min: number;         // first reminder after N minutes without an order
  second: boolean;           // send a second e-mail
  delay2Hours: number;       // second e-mail N hours after the first (secondMode "delay")
  /** "morning": the second e-mail goes the next morning at morningHour, buyer's local time (default). */
  secondMode: 'morning' | 'delay';
  morningHour: number;       // local hour for the morning e-mail (10 = 10:00–13:59)
  pct2: number;              // discount in the 2nd e-mail when the cart has NO discount yet (0 = none)
  validHours2: number;       // how long that code is valid
  /** Third e-mail ("last chance") on the 3rd day, with a bigger one-day discount. */
  third: boolean;
  thirdHour: number;         // local hour for the 3rd e-mail
  pct3: number;              // discount in the 3rd e-mail, valid until the end of that day
  /** true: the e-mail discount adds up with the shop's other discounts (e.g. "2-3 bags");
   *  false (default): they don't add up — Shopify applies whichever saves the buyer more. */
  combineDiscounts: boolean;
  onlyConsent: boolean;      // automatic e-mails only to buyers with e-mail marketing consent
  fromName: string;
  fromEmail: string;         // optional own address; used only if its domain is verified in Semafor's Resend account
  replyTo: string;
  /** Look of the designed e-mails (empty = automatic: shop name as text logo, design's own colour). */
  brandName: string;
  brandTagline: string;
  logoUrl: string;
  accent: string;
}

export const DEFAULT_RECOVERY: RecoverySettings = {
  enabled: false, first: true, delay1Min: 60, second: true, delay2Hours: 24, secondMode: 'morning', morningHour: 10, pct2: 15, validHours2: 24, third: true, thirdHour: 12, pct3: 20, combineDiscounts: false,
  onlyConsent: true, fromName: '', fromEmail: '', replyTo: '', brandName: '', brandTagline: '', logoUrl: '', accent: '',
};

export const DEFAULT_SETTINGS: ShopSettings = {
  thresholds: { block: 100, warn: 40 },
  yellowAction: 'tag',
  cancelRed: false,
  shareNetwork: true,
  networkImmediate: ['chargeback', 'abuse'],
  recovery: DEFAULT_RECOVERY,
  uiLang: null,
  adminLocale: null,
  shopCountry: null,
  popup: DEFAULT_POPUP,
  popupSeenAt: null,
};

export function settingsOf(json: unknown): ShopSettings {
  const j = (json as Partial<ShopSettings>) ?? {};
  return { ...DEFAULT_SETTINGS, ...j, recovery: { ...DEFAULT_RECOVERY, ...(j.recovery ?? {}) }, popup: { ...DEFAULT_POPUP, ...(j.popup ?? {}) } };
}

/**
 * Decision "со второго раза": a refuz_colet entry is shared with the network only when the same
 * shop already has another refuz_colet entry on any of the same identifiers.
 * @param reason  reason of the entry being saved
 * @param priorSameShopRefuzCount  number of earlier refuz_colet entries of this shop matching ≥1 identifier
 */
export function shouldShareToNetwork(s: ShopSettings, reason: string, priorSameShopRefuzCount: number): boolean {
  if (!s.shareNetwork) return false;
  if ((s.networkImmediate as string[]).includes(reason)) return true;
  if (reason === 'refuz_colet') return priorSameShopRefuzCount >= 1;
  return false; // return_fraud / other: never automatically
}
