# Semafor (ex-Refuz) — Shopify blacklist app (Romania-first)

Status 2026-10-06: **core logic written and tested**; app shell not yet scaffolded.

Architecture doc: https://claude.ai/code/artifact/ae68f0f8-596c-4488-9ed5-bdceebf271bd

## What is in this repo

| Path | What | State |
| --- | --- | --- |
| `core/normalize.ts` | e-mail / phone / name / address / device normalisation (RO rules: gmail dots, +40/0040, diacritics, str./bl./ap.) | ✅ tested |
| `core/hash.ts` | HMAC hashing for DB + network, short hash for checkout metafield | ✅ tested |
| `core/score.ts` | identifier extraction from an order, weights, thresholds, network traffic light | ✅ tested |
| `test/core.test.ts` | 11 tests (`node --experimental-strip-types --test test/core.test.ts`) | ✅ 11/11 |
| `prisma/schema.prisma` | shops, block_entries, identifiers, order_checks, audit_log, device_events, network_reports | ✅ draft |
| `app/check-order.ts` | webhook pipeline: lookup → network → score → tag + risk assessment (+ cancel) | ✅ draft, untested against a shop |
| `extensions/checkout-validation/` | Shopify Function: blocks checkout by exact short-hash match from metafield | ✅ draft (needs `sha256.js` + `normalize-lite.js` ports for the wasm sandbox) |
| `extensions/storefront/assets/refuz-device.js` | device fingerprint → cart attribute `_dev` | ✅ draft |

## Next steps (stage 1 — "Каркас")

1. `shopify app init` (Remix template, TypeScript) → copy `core/`, `prisma/`, `app/check-order.ts`, extensions in.
2. Partners account → create app "Refuz", scopes: `read_orders, write_orders, read_customers, write_order_risk_assessments, write_metafields` (+ `write_cart_transforms` not needed).
3. Webhooks: `orders/create` → queue → `checkOrder`; `app/uninstalled`; GDPR `customers/data_request`, `customers/redact`, `shop/redact`.
4. Admin pages (Polaris): list / add entry (e-mail, phone, name, address, reason, note) / import CSV / settings (thresholds, yellow action, share network).
5. Metafield builder: after any entry change rebuild `refuz.blocklist` JSON (short SHA-256 hashes) and `metafieldsSet` on the shop.
6. Admin UI extension on order page: traffic light + "why" + "Add to blacklist" button.
7. Install on mihailiuc-2 (dev store flag), import the current Chargeback/Blacklist app's list, run both in parallel for 2 weeks.

## Open decisions (from the doc) — still waiting

- ~~Yellow by default~~ → **tag only** (decided 2026-10-06)
- ~~Refuz colet → network~~ → **from the 2nd time** in the same shop; chargeback/abuse immediately (decided 2026-10-06)
- Pricing: free ≤50 entries w/o network; 9–19 $/mo with network+device?
- Name/domain: Refuz / ColetSigur / other.
- Legal owner of the registry (Mihailiuc Group SRL?).
- Does the current app export CSV?
