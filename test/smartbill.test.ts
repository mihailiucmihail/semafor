import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftOf, payloadOf } from '../core/smartbill.ts';

const m = (a: number) => ({ presentmentMoney: { amount: String(a) } });
// order #4278 as Shopify returns it: EUR shop, RON presentment
const o4278 = {
  id: 'gid://shopify/Order/1', name: '#4278', createdAt: '2026-11-01T10:53:23Z', cancelledAt: null, taxesIncluded: true, presentmentCurrencyCode: 'RON',
  displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', email: 'x@y.ro',
  customAttributes: [{ key: 'FanCourier status', value: 'Livrat' }],
  billingAddress: { name: 'Petruța Matei', address1: 'Str. Th Vascauteanu nr.2', city: 'Iasi', province: 'Iași', countryCodeV2: 'RO' },
  currentTotalPriceSet: { presentmentMoney: { amount: '282.0' }, shopMoney: { amount: '52.55' } },
  taxLines: [{ rate: 0.21 }],
  shippingLines: { nodes: [{ title: 'FANbox', originalPriceSet: m(10), discountAllocations: [] }] },
  lineItems: { nodes: [
    { name: 'MIA ESPRESSO', sku: 'mia', quantity: 1, currentQuantity: 1, originalUnitPriceSet: m(340), discountAllocations: [{ allocatedAmountSet: m(68) }] },
    { name: 'Gift box simple', sku: null, quantity: 1, currentQuantity: 1, originalUnitPriceSet: m(0), discountAllocations: [] },
  ] },
};

test('smartbill: RON amounts from presentment money, discount line, shipping, total check', () => {
  const d = draftOf(o4278);
  assert.equal(d.currency, 'RON');
  assert.equal(d.total, 282);
  assert.equal(d.ok, true);
  assert.equal(d.taxPct, 21);
  assert.equal(d.status.delivered, true);
  assert.deepEqual(d.lines.map((l) => [l.name, l.price, l.discount ?? 0]), [['MIA ESPRESSO', 340, 68], ['Transport', 10, 0]]);
  const p = payloadOf(d, { username: 'u', token: 't', cif: '123', series: 'MG' }, 'Normala', '2026-11-12');
  assert.equal(p.currency, 'RON');
  assert.equal(p.products.length, 3);
  assert.equal(p.products[1].isDiscount, true);
  assert.equal(p.products[1].discountValue, -68);
  assert.equal(p.products[2].isService, true);
  assert.equal(p.mentions, 'Comanda #4278');
});

test('smartbill: mismatch and cancelled orders are flagged', () => {
  const d = draftOf({ ...o4278, currentTotalPriceSet: m(300), cancelledAt: '2026-11-02T00:00:00Z' });
  assert.equal(d.ok, false);
  assert.equal(d.problems.length, 2);
  const nl = draftOf({ ...o4278, customAttributes: [{ key: 'FanCourier status', value: 'Retur la expeditor' }] });
  assert.equal(nl.status.delivered, false);
});
