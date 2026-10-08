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
  delay2Hours: number;       // second e-mail N hours after the first
  pct2: number;              // discount in the second e-mail (0 = none)
  validHours2: number;       // how long that code is valid
  onlyConsent: boolean;      // automatic e-mails only to buyers with e-mail marketing consent
  fromName: string;
  fromEmail: string;         // must be on a domain verified in Resend
  replyTo: string;
}

export const DEFAULT_RECOVERY: RecoverySettings = {
  enabled: false, delay1Min: 60, second: true, delay2Hours: 24, pct2: 10, validHours2: 24,
  onlyConsent: true, fromName: 'MIA by MIHAILIUC', fromEmail: '', replyTo: '',
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
