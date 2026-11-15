import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyVisit, orderSource, groupByAd, type AdOrder } from "../core/adattr.ts";

const v = (source: string, utm: any = null, sourceType: string | null = null) => ({ source, sourceType, landingPage: "https://mihailiuc.ro/", utmParameters: utm });

test("our new ad links: facebook / paid / names", () => {
  const r = classifyVisit(v("an unknown source", { source: "facebook", medium: "paid", campaign: "FACEBOOK | ROMANIA MIA IVORY | F 28-38", term: "ROMANIA MIA IVORY", content: "ROMANIA MIA IVORY" }));
  assert.equal(r.channel, "meta_ads");
  assert.equal(r.campaign, "FACEBOOK | ROMANIA MIA IVORY | F 28-38");
  assert.equal(r.ad, "ROMANIA MIA IVORY");
});

test("Meta auto links with IDs (#4397)", () => {
  const r = classifyVisit(v("an unknown source", { source: "facebook", medium: "paid", campaign: "120252784777700594", content: "120252784781220594", term: "120252784777890594" }));
  assert.equal(r.channel, "meta_ads");
  assert.equal(r.ad, "120252784781220594");
  assert.equal(r.adset, "120252784777890594");
});

test("old hand-made links: the same word everywhere", () => {
  const r = classifyVisit(v("Instagram", { source: "miaciocolataromania", medium: "miaciocolataromania", campaign: "miaciocolataromania", content: "miaciocolataromania", term: "52551879738451" }));
  assert.equal(r.channel, "meta_ads");
  assert.equal(r.campaign, "miaciocolataromania");
  const g = classifyVisit(v("x", { source: "germania-mia-maro", medium: "germania-mia-maro", campaign: "germania-mia-maro", content: "germania-mia-maro" }));
  assert.equal(g.channel, "meta_ads");
  assert.equal(g.campaign, "germania-mia-maro");
});

test("other channels", () => {
  assert.equal(classifyVisit(v("email", { source: "shopify_email", medium: "email", campaign: "Black Friday_201" }, "NEWSLETTER")).channel, "email");
  assert.equal(classifyVisit(v("Instagram", { source: "ig", medium: "social", content: "link_in_bio" })).channel, "instagram");
  assert.equal(classifyVisit(v("Instagram")).channel, "instagram");
  assert.equal(classifyVisit(v("Google", null, "SEO")).channel, "google");
  assert.equal(classifyVisit(v("direct")).channel, "direct");
  assert.equal(classifyVisit(v("https://mihailiuc.ro/cart")).channel, "direct");
  assert.equal(classifyVisit(v("https://www.pinterest.com/")).channel, "other");
  assert.equal(classifyVisit(null).channel, "unknown");
});

test("an ad in either visit wins; last click preferred", () => {
  const ad = { source: "facebook", medium: "paid", campaign: "C", content: "A" };
  const first = orderSource({ firstVisit: v("x", ad), lastVisit: v("email", { source: "shopify_email", medium: "email" }, "NEWSLETTER") });
  assert.equal(first.channel, "meta_ads"); assert.equal(first.touch, "first"); assert.equal(first.also, "email");
  const last = orderSource({ firstVisit: v("Google", null, "SEO"), lastVisit: v("x", ad) });
  assert.equal(last.channel, "meta_ads"); assert.equal(last.touch, "last"); assert.equal(last.also, "google");
  const none = orderSource({ firstVisit: null, lastVisit: null });
  assert.equal(none.channel, "unknown");
  const direct = orderSource({ firstVisit: v("Instagram"), lastVisit: v("direct") });
  assert.equal(direct.channel, "instagram"); assert.equal(direct.touch, "first");
});

test("grouping by ad: counts, revenue per currency, cancelled left out, ID names", () => {
  const mk = (n: string, total: number, cur: string, campaign: string, ad: string, cancelled = false): AdOrder => ({
    id: "gid://shopify/Order/" + n, name: "#" + n, at: "2026-11-1" + n.slice(-1) + "T10:00:00Z", total, currency: cur, cancelled,
    src: { channel: "meta_ads", campaign, adset: null, ad, touch: "last", also: null },
  });
  const rows = groupByAd([
    mk("1", 300, "RON", "111111111111", "222222222222"),
    mk("2", 76, "EUR", "111111111111", "222222222222"),
    mk("3", 400, "RON", "111111111111", "222222222222", true),
    mk("4", 350, "RON", "germania-mia-maro", ""),
  ], { campaigns: { "111111111111": "ROMANIA MIA IVORY" }, ads: { "222222222222": "Reel Ivory" } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].campaign, "ROMANIA MIA IVORY");
  assert.equal(rows[0].ad, "Reel Ivory");
  assert.equal(rows[0].orders.length, 3);
  assert.deepEqual(rows[0].revenue, { RON: 300, EUR: 76 });
  assert.equal(rows[1].ad, "—");
});

import { periodRange, parsePeriod, midnightIn } from "../core/adattr.ts";
test("periods: today / yesterday are Romanian calendar days", () => {
  const now = new Date("2026-11-15T13:40:00Z"); // 15:40 in Bucharest (UTC+2)
  assert.equal(midnightIn("Europe/Bucharest", now).toISOString(), "2026-11-14T22:00:00.000Z");
  const t = periodRange("today", now);
  assert.equal(t.since.toISOString(), "2026-11-14T22:00:00.000Z"); assert.equal(t.until, null); assert.equal(t.metaSince, "2026-11-15");
  const y = periodRange("yesterday", now);
  assert.equal(y.since.toISOString(), "2026-11-13T22:00:00.000Z"); assert.equal(y.until!.toISOString(), "2026-11-14T22:00:00.000Z"); assert.equal(y.metaUntil, "2026-11-14");
  const s = periodRange("today", new Date("2026-07-01T00:30:00Z")); // 03:30 summer time (UTC+3)
  assert.equal(s.since.toISOString(), "2026-06-30T21:00:00.000Z");
  assert.equal(parsePeriod("today"), "today"); assert.equal(parsePeriod("7"), 7); assert.equal(parsePeriod("x"), 30);
});
