// India / Pakistan / Morocco / Egypt: phone formats, no address matching, PIN-code COD rule at checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fastHash } from "../core/fasthash.ts";
import { normPhone, normAddress, parsePincodes, pincodeHit } from "../core/normalize.ts";
import { extractIdentifiers } from "../core/score.ts";
import { cartPaymentMethodsTransformRun as run } from "../extensions/semafor-hide-payment/src/run.js";

test("phones: every common way of writing the same number gives one E.164", () => {
  const same = (country: string, want: string, xs: string[]) => { for (const x of xs) assert.equal(normPhone(x, country), want, `${country} ${x}`); };
  same("IN", "+919876543210", ["9876543210", "09876543210", "919876543210", "+91 98765 43210", "+91-0-98765-43210", "0091 98765 43210", "98765-43210"]);
  same("IN", "+919123456789", ["9123456789", "+919123456789", "919123456789"]); // mobile that itself starts with 91
  same("PK", "+923001234567", ["03001234567", "3001234567", "923001234567", "+92 300 1234567", "+92 0300 1234567"]);
  same("MA", "+212612345678", ["0612345678", "612345678", "212612345678", "+212 6 12 34 56 78", "+212 0612345678"]);
  same("EG", "+201012345678", ["01012345678", "1012345678", "201012345678", "+20 10 1234 5678", "+20 01012345678"]);
});

test("phones: Romanian rules unchanged", () => {
  for (const x of ["+40 742 123 456", "0742 123 456", "0040742123456", "742123456", "+40 (0) 742 123 456"]) assert.equal(normPhone(x, "RO"), "+40742123456");
});

test("addresses are not matched in India / Pakistan, still matched in Romania", () => {
  assert.equal(normAddress({ address1: "Flat 302, Shanti Apartments, Andheri West", city: "Mumbai", country: "IN" }), null);
  assert.equal(normAddress({ address1: "House 12, Street 5, F-7", city: "Islamabad", country: "PK" }), null);
  assert.equal(normAddress({ address1: "Str. Mihai Eminescu nr. 12", city: "Iași", country: "RO" }), "mihai eminescu|12|iasi");
  const ids = extractIdentifiers({ phone: "9876543210", shipping_address: { first_name: "Ravi", last_name: "Kumar", address1: "Flat 302, Shanti Apartments", city: "Mumbai", zip: "400053", country_code: "IN" } }, "IN");
  assert.ok(!ids.some((i) => i.kind === "address" || i.kind === "name_address"));
  assert.ok(ids.some((i) => i.kind === "phone" && i.normalized === "+919876543210"));
});

test("PIN codes: parsing and matching", () => {
  assert.deepEqual(parsePincodes("110001, 110 002\n110-003;8*  12 *"), ["110001", "110002", "110003", "8*"]);
  assert.deepEqual(parsePincodes("40*\n400053"), ["40*", "400053"]);
  assert.ok(pincodeHit(["400053"], "400 053"));
  assert.ok(pincodeHit(["40*"], "401107"));
  assert.ok(!pincodeHit(["40*"], "140053"));
  assert.ok(!pincodeHit(["400053"], ""));
});

const PM = [{ id: "card", name: "Razorpay (Cards, UPI, NetBanking)" }, { id: "cod", name: "Cash on Delivery (COD)" }];
const cart = (zip: string, phone = "9000000000") => ({
  localization: { country: { isoCode: "IN" } }, paymentMethods: PM,
  cart: { buyerIdentity: { email: null, phone }, deliveryGroups: [{ deliveryAddress: { firstName: "Ravi", lastName: "Kumar", address1: "Flat 302", address2: null, city: "Mumbai", zip, countryCode: "IN", phone } }], attribute: null },
});
const withList = (input: any, list: any) => ({ ...input, paymentCustomization: { metafield: { jsonValue: list } } });
const hidden = (r: any) => r.operations.map((o: any) => o.paymentMethodHide.paymentMethodId).sort();

test("checkout: PIN code hides only COD, prepaid stays", () => {
  const list = { v: 3, z: ["400053", "11*"], e: [], p: [], a: [], d: [], n: [], w: [], m: { r: "all", y: "none" } };
  assert.deepEqual(hidden(run(withList(cart("400053"), list))), ["cod"]);
  assert.deepEqual(hidden(run(withList(cart("110 045"), list))), ["cod"]);
  assert.deepEqual(hidden(run(withList(cart("560001"), list))), []);
});

test("checkout: a red buyer is still blocked completely in a PIN-code area; Indian phone formats match", () => {
  const list = { v: 3, z: ["400053"], e: [], p: [fastHash("phone:+919876543210")], a: [], d: [], n: [], w: [], m: { r: "all", y: "none" } };
  assert.deepEqual(hidden(run(withList(cart("400053", "09876543210"), list))), ["card", "cod"]);
  assert.deepEqual(hidden(run(withList(cart("560001", "+91 98765 43210"), list))), ["card", "cod"]);
});

test("checkout: Indian COD names are recognised", () => {
  const list = { v: 3, z: ["400053"], e: [], p: [], a: [], d: [], n: [], w: [], m: { r: "all", y: "none" } };
  for (const name of ["Cash on Delivery (COD)", "Pay on Delivery", "Payment on delivery", "COD", "कैश ऑन डिलीवरी", "الدفع عند الاستلام", "Paiement à la livraison"]) {
    const input = withList({ ...cart("400053"), paymentMethods: [{ id: "card", name: "PhonePe UPI" }, { id: "cod", name }] }, list);
    assert.deepEqual(hidden(run(input)), ["cod"], name);
  }
});

test("Free plan: up to 10 exact PIN codes, no ranges; Basic / Pro: all", async () => {
  const { pincodesFor } = await import("../core/plans.ts");
  const list = ["110*", ...Array.from({ length: 12 }, (_, i) => String(400050 + i))];
  const free = pincodesFor(list, "free");
  assert.equal(free.length, 10);
  assert.ok(!free.some((p) => p.endsWith("*")));
  assert.deepEqual(pincodesFor(list, "basic"), list);
  assert.deepEqual(pincodesFor(list, "pro"), list);
});
