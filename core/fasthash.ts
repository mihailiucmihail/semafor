// Fast 64-bit string hash for the checkout Function (payload v3).
// SHA-256 in QuickJS costs ~1M Wasm instructions per call and a checkout needs ~10 of them, which runs into
// Shopify's 11M-instruction cap. This is cyrb53's two 32-bit lanes (Math.imul mixing over UTF-16 code units),
// printed as 16 hex chars. It is NOT a cryptographic hash — neither was a 16-hex SHA-256 prefix of a phone number;
// the list lives in an app-owned metafield that merchants, other apps and the storefront cannot read.
// The server (Node) and the Function (QuickJS) run this same code, so both sides produce identical strings.
const HEX = "0123456789abcdef";
function hex32(x: number): string {
  let s = "";
  for (let i = 28; i >= 0; i -= 4) s += HEX[(x >>> i) & 15];
  return s;
}
export function fastHash(str: string): string {
  let h1 = 0xdeadbeef ^ 0x9e3779b9, h2 = 0x41c6ce57 ^ 0x85ebca6b;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return hex32(h2 >>> 0) + hex32(h1 >>> 0);
}
