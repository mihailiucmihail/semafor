// Order attribution ("was this order brought by Semafor, and how?") — shared types and the pure decision.
// The DB lookups live in app/semafor/attribution.server.ts.

export type AttrSource = 'popup_site' | 'popup_cart' | 'email';
export const ATTR_SOURCES: AttrSource[] = ['popup_site', 'popup_cart', 'email'];

/** One Semafor touch before the order. */
export interface Touch { source: AttrSource; at: string; kind?: string | null; code?: string | null }

/** Stored on OrderCheck.attribution and in the order metafield semafor.attribution. `primary` null = not brought by Semafor. */
export interface Attribution {
  v: 1;
  primary: AttrSource | null;
  /** time of the primary (last) touch */
  at: string | null;
  /** minutes between the primary touch and the order */
  delayMin: number | null;
  touches: Touch[];
  /** a Semafor discount code used in the order (pop-up code or a reminder-e-mail code) */
  usedCode: string | null;
  codeSource: 'popup' | 'email' | null;
}

export const EMAIL_WINDOW_DAYS = 14;
export const POPUP_WINDOW_DAYS = 90;

/**
 * Decides the attribution from the touches found before the order.
 *  - pop-up leads count up to POPUP_WINDOW_DAYS before the order, reminder e-mails up to EMAIL_WINDOW_DAYS;
 *  - the primary source is the most recent touch ("last touch"); all touches are kept;
 *  - the pop-up code counts only together with a pop-up touch of this buyer (the same code can be public),
 *    a reminder code only when it was sent to this buyer.
 */
export function decideAttribution(input: {
  orderAt: Date;
  leads: Array<{ source: string; createdAt: Date }>;
  sends: Array<{ kind: string; createdAt: Date; discountCode?: string | null }>;
  discountCodes: string[];
  popupCode: string;
}): Attribution {
  const t0 = +input.orderAt;
  const touches: Touch[] = [];
  for (const l of input.leads) {
    const age = t0 - +l.createdAt;
    if (age < 0 || age > POPUP_WINDOW_DAYS * 86_400_000) continue;
    touches.push({ source: l.source === 'cart' ? 'popup_cart' : 'popup_site', at: l.createdAt.toISOString() });
  }
  for (const s of input.sends) {
    if (!['auto1', 'auto2', 'auto3', 'manual'].includes(s.kind)) continue;
    const age = t0 - +s.createdAt;
    if (age < 0 || age > EMAIL_WINDOW_DAYS * 86_400_000) continue;
    touches.push({ source: 'email', at: s.createdAt.toISOString(), kind: s.kind, code: s.discountCode ?? null });
  }
  touches.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const codes = input.discountCodes.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
  let usedCode: string | null = null, codeSource: Attribution['codeSource'] = null;
  const pc = String(input.popupCode || '').toUpperCase();
  if (pc && codes.includes(pc) && touches.some((t) => t.source !== 'email')) { usedCode = pc; codeSource = 'popup'; }
  const mailCode = touches.find((t) => t.source === 'email' && t.code && codes.includes(String(t.code).toUpperCase()));
  if (mailCode) { usedCode = String(mailCode.code).toUpperCase(); codeSource = 'email'; }
  const last = touches[touches.length - 1] ?? null;
  return {
    v: 1, primary: last?.source ?? null, at: last?.at ?? null,
    delayMin: last ? Math.max(0, Math.round((t0 - +new Date(last.at)) / 60_000)) : null,
    touches, usedCode, codeSource,
  };
}

/** Order tag per source (short; shown in the Shopify orders list next to the traffic light). */
export const ATTR_TAG: Record<'ro' | 'en', Record<AttrSource, string>> = {
  ro: { popup_site: 'Semafor · Pop-up', popup_cart: 'Semafor · Pop-up coș', email: 'Semafor · E-mail' },
  en: { popup_site: 'Semafor · Pop-up', popup_cart: 'Semafor · Pop-up cart', email: 'Semafor · E-mail' },
};
export const ALL_ATTR_TAGS = [...new Set([...Object.values(ATTR_TAG.ro), ...Object.values(ATTR_TAG.en)])];
