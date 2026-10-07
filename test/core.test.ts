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
