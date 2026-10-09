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
}

export interface RecoverySettings {
  enabled: boolean;          // automatic e-mails on/off
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
  enabled: false, delay1Min: 60, second: true, delay2Hours: 24, secondMode: 'morning', morningHour: 10, pct2: 15, validHours2: 24, third: true, thirdHour: 12, pct3: 20, combineDiscounts: false,
  onlyConsent: true, fromName: '', fromEmail: '', replyTo: '', brandName: '', brandTagline: '', logoUrl: '', accent: '',
};

export const DEFAULT_SETTINGS: ShopSettings = {
  thresholds: { block: 100, warn: 40 },
  yellowAction: 'tag',
  cancelRed: false,
  shareNetwork: true,
  networkImmediate: ['chargeback', 'abuse'],
  recovery: DEFAULT_RECOVERY,
};

export function settingsOf(json: unknown): ShopSettings {
  const j = (json as Partial<ShopSettings>) ?? {};
  return { ...DEFAULT_SETTINGS, ...j, recovery: { ...DEFAULT_RECOVERY, ...(j.recovery ?? {}) } };
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
