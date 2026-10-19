// Equivalence of the checkout Function's payload formats: same blacklist, same carts → same decision.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fastHash } from "../core/fasthash.ts";
import { normEmail, normPhone, normAddress, normName } from "../core/normalize.ts";
import { cartPaymentMethodsTransformRun as run } from "../extensions/semafor-hide-payment/src/run.js";
const sha = (k: string) => createHash("sha256").update(k).digest("hex").slice(0, 16);
const names = ["Ioana-Maria Popescu-Ștefănescu","Andrei Pop","Elena Vasile","Mihai Ionescu","Ștefan Țurcanu","Ana Maria"];
const streets = ["Strada Mihai Eminescu nr. 12, bl. A2, ap. 5","Bd. Unirii 7","Șos. Pantelimon nr 300","Calea Victoriei 1","Aleea Teilor nr 4 bl 3"];
const cities = ["București Sector 3","Cluj-Napoca","Iași","Brașov",""];
const emails = ["ioana.popescu+x@gmail.com","andrei@yahoo.com","elena.v@outlook.com","mihai@icloud.com","stefan@gmail.com"];
const phones = ["+40 742 123 456","0742 123 457","0040742123458","742123459","+40 (0) 742 123 460"];
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const PM = [{ id: "c", name: "Card" }, { id: "r", name: "Ramburs" }];
test('checkout Function: v3 (fastHash, sorted, network split) decides exactly like v2 (SHA-256)', () => {
let diff = 0, hits = 0, N = 3000;
for (let t = 0; t < N; t++) {
  // blacklist: random subset of real identifiers
  const own: Record<string, string[]> = { e: [], p: [], a: [], d: [], n: [], w: [] };
  const net: Record<string, string[]> = { e: [], p: [] };
  const yl: Record<string, string[]> = { e: [], p: [] };
  const add = (b: string, kind: string, norm: string | null) => { if (norm) own[b].push(`${kind}:${norm}`); };
  if (Math.random() < .3) add("e", "email", normEmail(pick(emails)));
  if (Math.random() < .3) add("p", "phone", normPhone(pick(phones), "RO"));
  if (Math.random() < .3) add("a", "address", normAddress({ address1: pick(streets), city: pick(cities) }));
  if (Math.random() < .2) add("d", "device", "dev-" + Math.floor(Math.random() * 3));
  if (Math.random() < .2) add("n", "name", normName(...(pick(names).split(" ") as [string, string])));
  if (Math.random() < .2) add("w", "nw", pick(["popescu", "andrei", "vasile", "turcanu"]));
  if (Math.random() < .3) net.e.push(`email:${normEmail(pick(emails))}`);
  if (Math.random() < .3) net.p.push(`phone:${normPhone(pick(phones), "RO")}`);
  if (Math.random() < .3) yl.e.push(`email:${normEmail(pick(emails))}`);
  if (Math.random() < .3) yl.p.push(`phone:${normPhone(pick(phones), "RO")}`);
  const m = { r: pick(["all", "cod", "none"]), y: pick(["all", "cod", "none"]) };
  for (const k of Object.keys(own)) for (let i = 0; i < 30; i++) own[k].push(`${k}:noise${t}-${i}`);
  // v2: network red mixed into e/p, all SHA
  const v2: any = { v: 2, m, y: { e: yl.e.map(sha), p: yl.p.map(sha) } };
  for (const k of Object.keys(own)) v2[k] = own[k].map(sha);
  v2.e.push(...net.e.map(sha)); v2.p.push(...net.p.map(sha));
  // v3: network either converted to fastHash (normalized known) or left as SHA in ne/np/y — mix both at random
  const v3: any = { v: 3, m, y: { e: [] as string[], p: [] as string[] }, yf: { e: [] as string[], p: [] as string[] }, ne: [] as string[], np: [] as string[] };
  for (const k of Object.keys(own)) v3[k] = own[k].map(fastHash);
  for (const x of net.e) Math.random() < .5 ? v3.e.push(fastHash(x)) : v3.ne.push(sha(x));
  for (const x of net.p) Math.random() < .5 ? v3.p.push(fastHash(x)) : v3.np.push(sha(x));
  for (const x of yl.e) Math.random() < .5 ? v3.yf.e.push(fastHash(x)) : v3.y.e.push(sha(x));
  for (const x of yl.p) Math.random() < .5 ? v3.yf.p.push(fastHash(x)) : v3.y.p.push(sha(x));
  for (const k of Object.keys(v3)) if (Array.isArray(v3[k])) v3[k].sort();
  for (const g of [v3.y, v3.yf]) for (const k of Object.keys(g)) g[k].sort();
  const [f, l] = pick(names).split(" ");
  const cart = { buyerIdentity: { email: pick(emails), phone: pick(phones) }, deliveryGroups: [{ deliveryAddress: { firstName: f, lastName: l, address1: pick(streets), address2: null, city: pick(cities), phone: pick(phones) } }], attribute: { value: "dev-" + Math.floor(Math.random() * 3) } };
  const base = { paymentMethods: PM, localization: { country: { isoCode: "RO" } }, cart };
  const a = JSON.stringify(run({ ...base, paymentCustomization: { metafield: { jsonValue: v2 } } }));
  const b = JSON.stringify(run({ ...base, paymentCustomization: { metafield: { jsonValue: v3 } } }));
  if (a !== b) { diff++;  }
  if (a !== '{"operations":[]}') hits++;
}
assert.equal(diff, 0); assert.ok(hits > N / 10);

});
