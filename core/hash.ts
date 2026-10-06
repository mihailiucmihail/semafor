// Refuz — HMAC hashing of normalized identifiers.
// The network registry only ever sees these hashes, never raw values.
import { createHmac } from 'node:crypto';
import type { IdKind } from './normalize.ts';

/** Full 32-byte hash as hex (DB + network registry). Keyed by server secret so a leaked table is useless without it. */
export function hmacId(secret: string, kind: IdKind, normalized: string): string {
  return createHmac('sha256', secret).update(`${kind}:${normalized}`).digest('hex');
}

/** Short 8-byte prefix (16 hex chars) for the shop metafield read by the Checkout Validation Function. */
export function shortHash(fullHex: string): string {
  return fullHex.slice(0, 16);
}

/** Irreversible shop reference for the network registry (one vote per shop per hash). */
export function shopRef(secret: string, shopDomain: string): string {
  return createHmac('sha256', secret).update(`shop:${shopDomain.toLowerCase()}`).digest('hex').slice(0, 32);
}
