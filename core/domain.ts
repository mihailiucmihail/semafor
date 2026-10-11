// Sending-domain validation (shared, pure): app/semafor/domains.server.ts
/** Public mailbox providers: nobody may claim them. */
const PUBLIC = [
  /^gmail\.com$/, /^googlemail\.com$/, /^yahoo\.[a-z.]+$/, /^ymail\.com$/, /^outlook\.[a-z.]+$/, /^hotmail\.[a-z.]+$/, /^live\.[a-z.]+$/, /^msn\.com$/,
  /^icloud\.com$/, /^me\.com$/, /^mac\.com$/, /^aol\.[a-z.]+$/, /^gmx\.[a-z.]+$/, /^web\.de$/, /^t-online\.de$/, /^yandex\.[a-z.]+$/, /^ya\.ru$/,
  /^mail\.ru$/, /^bk\.ru$/, /^list\.ru$/, /^inbox\.ru$/, /^proton(mail)?\.[a-z.]+$/, /^pm\.me$/, /^zoho\.com$/, /^wp\.pl$/, /^o2\.pl$/, /^onet\.pl$/,
  /^interia\.pl$/, /^seznam\.cz$/, /^libero\.it$/, /^orange\.fr$/, /^free\.fr$/, /^laposte\.net$/, /^qq\.com$/, /^163\.com$/, /^fastmail\.[a-z.]+$/,
];


/** "https://www.Shop.ro/path" → "shop.ro"; null when it isn't a plausible domain. */
export function cleanDomain(input: string): string | null {
  let d = String(input || "").trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").replace(/^[^@/]*@/, "").split(/[/?#:]/)[0].replace(/^www\./, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  return d;
}

export function checkDomainAllowed(d: string): "public" | "shopify" | null {
  if (/(^|\.)myshopify\.com$/.test(d) || /(^|\.)shopify\.com$/.test(d)) return "shopify";
  if (PUBLIC.some((re) => re.test(d))) return "public";
  return null;
}

