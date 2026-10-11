import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normEmail, normPhone, normName, normAddress } from '../core/normalize.ts';
import { hmacId, shortHash } from '../core/hash.ts';
import { extractIdentifiers, scoreOrder, combinedLevel } from '../core/score.ts';

test('email: gmail dots and +tags collapse', () => {
  assert.equal(normEmail('Andreea.Popescu+shop@Gmail.com '), 'andreeapopescu@gmail.com');
  assert.equal(normEmail('andreeapopescu@googlemail.com'), 'andreeapopescu@gmail.com');
  assert.equal(normEmail('Ion.Pop+x@yahoo.com'), 'ion.pop@yahoo.com'); // dots kept outside gmail
  assert.equal(normEmail('broken@'), null);
});

test('phone: Romanian formats → E.164', () => {
  for (const v of ['0743 088 138', '+40 743 088 138', '0040743088138', '+40 (0) 743-088-138', '743088138', '40743088138']) {
    assert.equal(normPhone(v), '+40743088138', v);
  }
  assert.equal(normPhone('0151 2345678', 'DE'), '+491512345678');
  assert.equal(normPhone('+48 600 123 456'), '+48600123456');
  assert.equal(normPhone('abc'), null);
});

test('name: diacritics, order, hyphen', () => {
  assert.equal(normName('Ștefan-Andrei', 'Țîrlea'), 'andrei stefan tirlea');
  assert.equal(normName('Tirlea Stefan Andrei'), 'andrei stefan tirlea');
  assert.equal(normName('POPESCU', 'Ioana'), 'ioana popescu');
});

test('address: str./strada/bl./ap. normalise to one key', () => {
  const a = normAddress({ address1: 'Str. Mihai Eminescu nr. 12, bl. A2, sc. B, ap. 5', city: 'București, Sector 3' });
  const b = normAddress({ address1: 'strada mihai eminescu 12', address2: 'Bloc A2 Ap 5', city: 'Bucuresti' });
  const c = normAddress({ address1: 'Bd. Mihai Eminescu Nr 12', city: 'Mun. Bucuresti' });
  assert.equal(a, 'mihai eminescu|12|bucuresti');
  assert.equal(b, a);
  assert.equal(c, a);
  assert.equal(normAddress({ address1: 'Strada Lungă', city: 'Brașov' }), null); // no number → too weak
  assert.equal(normAddress({ address1: 'Aleea Trandafirilor 3A', city: 'Cluj-Napoca' }), 'trandafirilor|3a|cluj napoca');
});

test('hash: stable, keyed, short prefix', () => {
  const h = hmacId('secret', 'email', 'a@b.ro');
  assert.equal(h, hmacId('secret', 'email', 'a@b.ro'));
  assert.notEqual(h, hmacId('other', 'email', 'a@b.ro'));
  assert.notEqual(h, hmacId('secret', 'phone', 'a@b.ro'));
  assert.equal(shortHash(h).length, 16);
});

const order = {
  email: 'Andreea.Popescu@gmail.com',
  phone: null,
  customer: { first_name: 'Andreea', last_name: 'Popescu' },
  shipping_address: { first_name: 'Andreea', last_name: 'Popescu', phone: '0743 088 138', address1: 'Str. Mihai Eminescu nr. 12, ap. 5', city: 'București' },
  note_attributes: [{ name: '_dev', value: 'AB12cd34ef56AB12cd34ef56AB12cd34' }],
};

test('extract: one row per normalized identifier', () => {
  const ids = extractIdentifiers(order);
  const kinds = ids.map((i) => `${i.kind}=${i.normalized}`);
  assert.deepEqual(kinds, [
    'email=andreeapopescu@gmail.com',
    'phone=+40743088138',
    'name=andreea popescu',
    'address=mihai eminescu|12|bucuresti',
    'address=mihai eminescu|12|*',
    'name=andreea',
    'name=popescu',
    'name_address=andreea popescu#mihai eminescu|12|bucuresti',
    'device=ab12cd34ef56ab12cd34ef56ab12cd34',
  ]);
});

test('score: phone match alone blocks; name alone only warns', () => {
  const ids = extractIdentifiers(order);
  const own = (kind: string, n: string) => (kind === 'phone' && n === '+40743088138' ? [{ entryId: 'e1', reason: 'refuz_colet' }] : []);
  const r = scoreOrder({ ids, own });
  assert.equal(r.score, 100);
  assert.equal(r.level, 'red');

  const ownName = (kind: string, n: string) => (kind === 'name' && n === 'andreea popescu' ? [{ entryId: 'e2', reason: 'refuz_colet' }] : []);
  const r2 = scoreOrder({ ids, own: ownName });
  assert.equal(r2.score, 40);
  assert.equal(r2.level, 'yellow');
});

test('score: name+address pair counts once (100), not 100+40+60', () => {
  const ids = extractIdentifiers(order);
  const own = (kind: string) => (['name', 'address', 'name_address'].includes(kind) ? [{ entryId: 'e3', reason: 'chargeback' }] : []);
  const r = scoreOrder({ ids, own });
  assert.equal(r.score, 100);
});

test('score: two unrelated entries do not add up', () => {
  const ids = extractIdentifiers(order);
  const own = (kind: string) => (kind === 'name' ? [{ entryId: 'a', reason: 'other' }] : kind === 'address' ? [{ entryId: 'b', reason: 'other' }] : []);
  const r = scoreOrder({ ids, own });
  assert.equal(r.score, 60);
  assert.equal(r.level, 'yellow');
});

test('network: 3 shops → red even with empty own list', () => {
  const ids = extractIdentifiers(order);
  const r = scoreOrder({ ids, own: () => [], network: (k) => (k === 'phone' ? { kind: 'phone', shops: 3, reasons: ['refuz_colet'] } : null) });
  assert.equal(r.level, 'green');
  assert.equal(r.networkLevel, 'red');
  assert.equal(combinedLevel(r), 'red');
  const r1 = scoreOrder({ ids, own: () => [], network: (k) => (k === 'email' ? { kind: 'email', shops: 1, reasons: ['chargeback'] } : null) });
  assert.equal(combinedLevel(r1), 'yellow');
});

test('device on iPhone is weak (30)', () => {
  const ids = extractIdentifiers(order);
  const own = (kind: string) => (kind === 'device' ? [{ entryId: 'd', reason: 'other' }] : []);
  assert.equal(scoreOrder({ ids, own }).score, 70);
  assert.equal(scoreOrder({ ids, own, isIphone: true }).score, 30);
});

import { shouldShareToNetwork, DEFAULT_SETTINGS } from '../core/settings.ts';
test('network sharing: refuz_colet from the 2nd time, chargeback immediately, yellow = tag only', () => {
  assert.equal(DEFAULT_SETTINGS.yellowAction, 'tag');
  assert.equal(shouldShareToNetwork(DEFAULT_SETTINGS, 'refuz_colet', 0), false);
  assert.equal(shouldShareToNetwork(DEFAULT_SETTINGS, 'refuz_colet', 1), true);
  assert.equal(shouldShareToNetwork(DEFAULT_SETTINGS, 'chargeback', 0), true);
  assert.equal(shouldShareToNetwork({ ...DEFAULT_SETTINGS, shareNetwork: false }, 'chargeback', 5), false);
});

test('import compatibility: city-less address and one-word names', () => {
  assert.equal(normAddress({ address1: 'Str Oituz,nr 22' }), 'oituz|22|*');
  assert.equal(normName('sevda bolat', 'sevda bolat'), 'bolat sevda');
  const ids = extractIdentifiers({ shipping_address: { first_name: 'Hulia', last_name: 'Suliman', address1: 'Strada Oituz 22', city: 'Bacău' } });
  const keys = ids.map((i) => `${i.kind}:${i.normalized}`);
  assert.ok(keys.includes('address:oituz|22|*'));
  assert.ok(keys.includes('address:oituz|22|bacau'));
  assert.ok(keys.includes('name:suliman'));
  assert.ok(keys.includes('name:hulia suliman'));
});

// ---- plans ----
import { planFromSubscriptionName, can, effectiveSettings } from '../core/plans.ts';
test('plans: subscription name → plan', () => {
  assert.equal(planFromSubscriptionName('Semafor Pro'), 'pro');
  assert.equal(planFromSubscriptionName('Basic'), 'basic');
  assert.equal(planFromSubscriptionName(''), 'free');
});
test('plans: feature gates and effective settings', () => {
  assert.equal(can('free', 'recovery'), false);
  assert.equal(can('basic', 'checkout_block'), true);
  assert.equal(can('basic', 'checkout_stats'), false);
  assert.equal(can('pro', 'recovery'), true);
  const s = { ...DEFAULT_SETTINGS, yellowAction: 'block' as const, cancelRed: true };
  assert.deepEqual([effectiveSettings(s, 'free').yellowAction, effectiveSettings(s, 'free').cancelRed], ['tag', false]);
  assert.deepEqual([effectiveSettings(s, 'basic').yellowAction, effectiveSettings(s, 'basic').cancelRed], ['block', true]);
});

// ── storefront pop-up config (core/popup.ts) ──
import { cleanPopup, buildPopupConfig, textOverrides, POPUP_DEFAULT_TEXTS } from '../core/popup.ts';
import { settingsOf } from '../core/settings.ts';

test('popup: defaults, clamping and stored overrides', () => {
  const s = settingsOf({});
  assert.equal(s.popup.enabled, false);
  assert.equal(s.popup.cartDelay, 4);
  assert.equal(s.popup.mode, 'smart');
  assert.equal(s.popup.code, 'WELCOME15');
  assert.equal(cleanPopup({ pct: 20 }).code, 'WELCOME20');
  assert.equal(cleanPopup({ codeMode: 'own', code: 'bunvenit15', pct: 15 }).code, 'BUNVENIT15');
  const p = cleanPopup({ enabled: true, mode: 'cart', codeMode: 'own', delay: 9999, cartDelay: -3, hideDays: 0, code: ' bun venit15 ', design: 'nope' as any, imageUrl: 'http://x', texts: { ro: { ...POPUP_DEFAULT_TEXTS.ro, heading: 'Salut' } } });
  assert.equal(p.mode, 'cart');
  assert.equal(p.delay, 300);
  assert.equal(p.cartDelay, 0);
  assert.equal(p.hideDays, 1);
  assert.equal(p.code, 'BUNVENIT15');
  assert.equal(p.design, 'classic');
  assert.equal(p.imageUrl, '');
  assert.deepEqual(p.texts, { ro: { heading: 'Salut' } }); // only what differs from the defaults is stored
  assert.deepEqual(textOverrides('de', POPUP_DEFAULT_TEXTS.de), {});
});

test('popup: storefront config fills {shop} and {pct} in every language', () => {
  const cfg = buildPopupConfig(cleanPopup({ enabled: true, pct: 20 }), 'MIHAILIUC');
  assert.equal(cfg.texts.ro.bigLabel, '-20%');
  assert.match(cfg.texts.ro.text, /noutățile MIHAILIUC și primești 20% reducere/);
  assert.match(cfg.texts.de.text, /20 % Rabatt/);
  assert.ok(!/\{(shop|pct)\}/.test(JSON.stringify(cfg)));
  assert.deepEqual(Object.keys(cfg.texts).sort(), ['de', 'en', 'pl', 'ro']);
});

// ── skip reasons read as sentences (app/i18n.ts trMsg) ──
import { trMsg } from '../app/i18n.ts';
test('skip reasons: plain sentences in both languages', () => {
  assert.equal(trMsg('ro', 'out_of_stock: MIA – Dark Cherry'), 'Nu am trimis: produsul din coș nu mai e pe stoc (MIA – Dark Cherry).');
  assert.equal(trMsg('en', 'out_of_stock: MIA – Dark Cherry'), 'Not sent: the item in the cart is out of stock (MIA – Dark Cherry).');
  assert.match(trMsg('ro', 'a comandat între timp'), /^Nu am trimis: /);
  assert.match(trMsg('en', 'fără produse în coș'), /^Not sent: /);
  assert.equal(trMsg('en', 'Client necunoscut'), 'Unknown customer');
});

// ── order attribution (core/attribution.ts) ──
import { decideAttribution } from '../core/attribution.ts';
test('attribution: last touch wins, windows, codes', () => {
  const orderAt = new Date('2026-10-11T14:00:00Z');
  const h = (n: number) => new Date(+orderAt - n * 3_600_000);
  const a = decideAttribution({ orderAt, popupCode: 'WELCOME15', discountCodes: ['welcome15'],
    leads: [{ source: 'cart', createdAt: h(48) }], sends: [{ kind: 'auto1', createdAt: h(20), discountCode: null }, { kind: 'welcome', createdAt: h(47) }] });
  assert.equal(a.primary, 'email');
  assert.equal(a.touches.length, 2); // the welcome e-mail is not a touch of its own
  assert.equal(a.delayMin, 20 * 60);
  assert.equal(a.usedCode, 'WELCOME15');
  assert.equal(a.codeSource, 'popup');
  // a reminder older than 14 days doesn't count; a pop-up lead from 30 days ago does
  const b = decideAttribution({ orderAt, popupCode: 'X', discountCodes: [], leads: [{ source: 'site', createdAt: h(24 * 30) }], sends: [{ kind: 'auto2', createdAt: h(24 * 15) }] });
  assert.equal(b.primary, 'popup_site');
  // the pop-up code alone (no pop-up touch of this buyer) is not attribution
  const c = decideAttribution({ orderAt, popupCode: 'BUNVENIT15', discountCodes: ['BUNVENIT15'], leads: [], sends: [] });
  assert.equal(c.primary, null);
  assert.equal(c.usedCode, null);
  // touches after the order are ignored; a reminder's own code is recognised
  const d = decideAttribution({ orderAt, popupCode: '', discountCodes: ['GIFT15-AB12C'], leads: [{ source: 'site', createdAt: h(-1) }], sends: [{ kind: 'auto2', createdAt: h(3), discountCode: 'GIFT15-AB12C' }] });
  assert.equal(d.primary, 'email');
  assert.equal(d.codeSource, 'email');
  assert.equal(d.touches.length, 1);
});

// ── own sending domain (core/domain.ts) ──
import { cleanDomain, checkDomainAllowed } from '../core/domain.ts';
test('sending domain: clean + refuse public / myshopify', () => {
  assert.equal(cleanDomain('https://www.Mihailiuc.ro/path?x=1'), 'mihailiuc.ro');
  assert.equal(cleanDomain('info@mihailiuc.de'), 'mihailiuc.de');
  assert.equal(cleanDomain('send.example.com:443'), 'send.example.com');
  assert.equal(cleanDomain('not a domain'), null);
  assert.equal(checkDomainAllowed('gmail.com'), 'public');
  assert.equal(checkDomainAllowed('yahoo.co.uk'), 'public');
  assert.equal(checkDomainAllowed('mail.ru'), 'public');
  assert.equal(checkDomainAllowed('x.myshopify.com'), 'shopify');
  assert.equal(checkDomainAllowed('mihailiuc.ro'), null);
});
