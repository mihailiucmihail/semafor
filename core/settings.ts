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
}

export const DEFAULT_SETTINGS: ShopSettings = {
  thresholds: { block: 100, warn: 40 },
  yellowAction: 'tag',
  cancelRed: false,
  shareNetwork: true,
  networkImmediate: ['chargeback', 'abuse'],
};

export function settingsOf(json: unknown): ShopSettings {
  return { ...DEFAULT_SETTINGS, ...(json as Partial<ShopSettings> ?? {}) };
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
