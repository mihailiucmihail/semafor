// Refuz — normalization of customer identifiers.
// One function per identifier kind. NORM_VERSION is stored next to every hash;
// bump it when a rule changes and re-hash in a background job.

export const NORM_VERSION = 1;

export type IdKind = 'email' | 'phone' | 'name' | 'address' | 'name_address' | 'device';

/** Strip Romanian (and general Latin) diacritics: ș→s, ț→t, ă→a, â→a, î→i, ş/ţ cedilla forms too. */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/Ł/g, 'L');
}

const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/** lower-case, trim; gmail: drop dots and +tag, googlemail→gmail; other providers: drop +tag only. */
export function normEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  const at = s.lastIndexOf('@');
  if (at < 1 || at === s.length - 1) return null;
  let local = s.slice(0, at);
  let domain = s.slice(at + 1).replace(/\.+$/, '');
  if (!domain.includes('.')) return null;
  local = local.split('+')[0];
  if (GMAIL.has(domain)) { local = local.replace(/\./g, ''); domain = 'gmail.com'; }
  if (!local) return null;
  return `${local}@${domain}`;
}

const CC: Record<string, string> = { RO: '40', MD: '373', DE: '49', PL: '48', AT: '43', IT: '39', ES: '34', FR: '33', GB: '44', HU: '36', BG: '359' };

/** E.164 ("+40743088138"). defaultCountry is used for national numbers starting with a single 0. */
export function normPhone(raw: string, defaultCountry = 'RO'): string | null {
  let s = raw.trim();
  if (!s) return null;
  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (plus) {
    // "+40 (0) 743…" → drop the trunk 0 after the country code
    if (d.startsWith('400')) d = '40' + d.slice(3);
    return d.length >= 8 && d.length <= 15 ? '+' + d : null;
  }
  if (d.startsWith('00')) {
    d = d.slice(2);
    if (d.startsWith('400')) d = '40' + d.slice(3);
    return d.length >= 8 && d.length <= 15 ? '+' + d : null;
  }
  const cc = CC[defaultCountry.toUpperCase()] ?? '40';
  if (d.startsWith('0')) d = cc + d.slice(1);
  else if (cc === '40' && d.length === 9 && d.startsWith('7')) d = '40' + d; // "743088138"
  else if (cc === '40' && d.startsWith('40') && d.length === 11) { /* already 40… */ }
  else if (!d.startsWith(cc)) d = cc + d;
  return d.length >= 8 && d.length <= 15 ? '+' + d : null;
}

function words(s: string): string[] {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/** Name: no diacritics, lower-case, hyphens → spaces, word order irrelevant (sorted). */
export function normName(first: string | null | undefined, last?: string | null): string | null {
  const w = words(`${first ?? ''} ${last ?? ''}`);
  if (w.length === 0) return null;
  return w.sort().join(' ');
}

// Romanian address vocabulary → one canonical spelling.
const ADDR_WORDS: Record<string, string> = {
  str: 'strada', st: 'strada', strada: 'strada', 'strad': 'strada',
  bd: 'bulevardul', bld: 'bulevardul', b: 'bulevardul', bdul: 'bulevardul', bulevard: 'bulevardul', bulevardul: 'bulevardul',
  sos: 'soseaua', soseaua: 'soseaua', sosea: 'soseaua',
  cal: 'calea', calea: 'calea',
  al: 'aleea', aleea: 'aleea',
  int: 'intrarea', intr: 'intrarea', intrarea: 'intrarea',
  spl: 'splaiul', splaiul: 'splaiul',
  pta: 'piata', piata: 'piata',
  nr: 'nr', numar: 'nr', numarul: 'nr', no: 'nr',
  bl: 'bloc', bloc: 'bloc', blocul: 'bloc',
  sc: 'scara', scara: 'scara',
  et: 'etaj', etaj: 'etaj', etajul: 'etaj',
  ap: 'apartament', apt: 'apartament', apartament: 'apartament', apartamentul: 'apartament',
  sect: 'sector', sector: 'sector', sectorul: 'sector', s: 'sector',
  jud: 'judet', judet: 'judet', judetul: 'judet',
  com: 'comuna', comuna: 'comuna', sat: 'sat', mun: 'municipiul', municipiul: 'municipiul', oras: 'oras',
};
// Words that describe the building/flat — kept, but not part of the street key.
const UNIT_WORDS = new Set(['bloc', 'scara', 'etaj', 'apartament']);
const STREET_TYPES = new Set(['strada', 'bulevardul', 'soseaua', 'calea', 'aleea', 'intrarea', 'splaiul', 'piata']);

function normCity(city: string | null | undefined): string {
  let w = words(city ?? '').map((x) => ADDR_WORDS[x] ?? x).filter((x) => !['municipiul', 'oras', 'comuna', 'sat', 'judet'].includes(x));
  // "bucuresti sector 3" → "bucuresti" (sector stays in the full address, not the city key)
  const si = w.indexOf('sector');
  if (si >= 0) w = w.slice(0, si);
  return w.join(' ');
}

export interface AddressInput { address1?: string | null; address2?: string | null; city?: string | null; zip?: string | null; country?: string | null }

/**
 * Address key = street name + number + city.
 * "Str. Mihai Eminescu nr. 12, bl. A2, ap. 5" + "București" → "mihai eminescu|12|bucuresti".
 * Street type (strada/bulevardul…) is dropped from the key because customers mix them up.
 * Returns null when there is no house number (too weak to block on).
 */
export function normAddress(a: AddressInput): string | null {
  const toks = words(`${a.address1 ?? ''} ${a.address2 ?? ''}`).map((x) => ADDR_WORDS[x] ?? x);
  const city = normCity(a.city);
  if (!toks.length || !city) return null;

  const street: string[] = [];
  let number: string | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (UNIT_WORDS.has(t) || t === 'sector') { i++; continue; } // skip "bloc A2", "ap 5"
    if (t === 'nr') { if (toks[i + 1]) { number = number ?? toks[i + 1]; i++; } continue; }
    if (STREET_TYPES.has(t)) continue;
    if (/^\d+[a-z]?$/.test(t)) { if (number === null && street.length) number = t; continue; }
    if (number === null) street.push(t);
  }
  if (!street.length || !number) return null;
  return `${street.join(' ')}|${number}|${city}`;
}

/** Name + address pair — the strong key used in the network. */
export function normNameAddress(name: string | null, address: string | null): string | null {
  return name && address ? `${name}#${address}` : null;
}

/** Device: the storefront script already sends a hex SHA-256; just validate and lower-case. */
export function normDevice(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  return /^[0-9a-f]{16,64}$/.test(s) ? s : null;
}
