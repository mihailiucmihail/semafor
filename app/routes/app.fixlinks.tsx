// One-off repair (admin only). Until 2026-11-03 recovery e-mails linked to the newest abandoned checkout of ANY
// buyer, so several people opened the same stranger's checkout (her data prefilled) and Semafor linked their
// browsers + whatever they typed to her blacklist entry. This replays the automatic device links using only
// "clean" checkout steps (a step on a checkout token that several browsers used counts only for the browser
// that created it) and lists the auto-added identifiers that clean data does not support.
//   GET            → dry run (plain text): what would be removed + who was wrongly blocked in the last 3 days
//   GET ?apply=1   → removes them (and from the network), writes an audit line, pushes the checkout blocklist
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop, SECRET } from "../semafor/shop.server";
import { buildIdentifiers, pushCheckoutMetafield, unshareFromNetwork } from "../semafor/entries.server";
import { hmacId } from "../../core/hash";
import { normDevice, type IdKind } from "../../core/normalize";
import { fetchOrder } from "../semafor/backfill.server";
import { checkOrder } from "../semafor/check-order.server";
import { settingsOf } from "../../core/settings";

const DAY = 86_400_000;
const LINK: IdKind[] = ["email", "phone", "address"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const apply = new URL(request.url).searchParams.get("apply") === "1";
  // ?recheck=<order number>,<…>: check these orders again now (same as the 15-minute re-check)
  // ?riskfix=<order number>: write Semafor's clean (NONE) assessment again and show Shopify's answer
  const rf = new URL(request.url).searchParams.get("riskfix");
  if (rf) {
    const row = (await db.orderCheck.findFirst({ where: { shopId: shop.id, orderName: `#${rf.replace("#", "")}` }, select: { orderId: true, level: true } })) as any;
    if (!row) return new Response("not found");
    const r: any = await (await admin.graphql(`#graphql
      mutation($in:OrderRiskAssessmentCreateInput!){ orderRiskAssessmentCreate(orderRiskAssessmentInput:$in){ orderRiskAssessment{ riskLevel } userErrors{ field message } } }`,
      { variables: { in: { orderId: row.orderId, riskLevel: "NONE", facts: [{ description: "Semafor: verificat din nou — nimic de semnalat", sentiment: "POSITIVE" }] } } })).json();
    return new Response(`level ${row.level}\n` + JSON.stringify(r), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const rq = new URL(request.url).searchParams.get("recheck");
  if (rq) {
    const out: string[] = [];
    for (const num of rq.split(",").map((x) => x.trim().replace("#", "")).filter(Boolean).slice(0, 10)) {
      const row = (await db.orderCheck.findFirst({ where: { shopId: shop.id, orderName: `#${num}` }, select: { orderId: true, level: true } })) as any;
      if (!row) { out.push(`#${num}: not found`); continue; }
      const order: any = await fetchOrder(admin as any, row.orderId);
      await checkOrder({ db, secret: SECRET, shopId: shop.id, shopDomain: shop.domain, country: shop.country, settings: settingsOf((shop as any).settings), order, admin: admin as any, skipCancel: true, recheck: true });
      const now = (await db.orderCheck.findFirst({ where: { shopId: shop.id, orderId: row.orderId }, select: { level: true, matched: true } })) as any;
      out.push(`#${num}: ${row.level} → ${now?.level} | ${((now?.matched as any[]) || []).map((m) => m.normalized || m.kind).join(" ; ")}`);
    }
    return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const entries = (await db.blockEntry.findMany({ where: { shopId: shop.id }, select: { id: true, createdAt: true, expiresAt: true, identifiers: { select: { id: true, kind: true, raw: true, hash: true, createdAt: true } } } })) as any[];
  const audits = (await db.auditLog.findMany({ where: { shopId: shop.id, action: { in: ["entry.link_device", "entry.add_data"] } }, select: { action: true, entryId: true, payload: true } })) as any[];
  const autoKeys = new Map<string, Set<string>>(), manualKeys = new Map<string, Set<string>>();
  for (const a of audits) {
    const m = a.action === "entry.link_device" ? autoKeys : manualKeys;
    const s = m.get(a.entryId) ?? new Set<string>();
    for (const x of a.payload?.added ?? []) s.add(`${x.kind}|${x.raw}`);
    m.set(a.entryId, s);
  }
  // auto = added by a device link, later than the entry itself, never added by hand
  const isAuto = (e: any, i: any) => +i.createdAt - +e.createdAt > 5000 && autoKeys.get(e.id)?.has(`${i.kind}|${i.raw}`) && !manualKeys.get(e.id)?.has(`${i.kind}|${i.raw}`);

  const attempts = (await db.checkoutAttempt.findMany({
    where: { shopId: shop.id, event: { not: "cart" }, createdAt: { gt: new Date(Date.now() - 150 * DAY) } }, orderBy: { createdAt: "asc" }, take: 40000,
    select: { deviceId: true, checkoutToken: true, event: true, email: true, phone: true, firstName: true, lastName: true, address1: true, city: true, country: true, orderId: true, createdAt: true },
  })) as any[];
  // checkout token → browser that created it; other browsers on that token opened someone else's checkout
  const owner = new Map<string, string>(), devsOf = new Map<string, Set<string>>();
  for (const a of attempts) if (a.checkoutToken) {
    if (!owner.has(a.checkoutToken)) owner.set(a.checkoutToken, a.deviceId);
    const s = devsOf.get(a.checkoutToken) ?? new Set<string>(); s.add(a.deviceId); devsOf.set(a.checkoutToken, s);
  }
  const tainted = (a: any) => !!a.checkoutToken && (devsOf.get(a.checkoutToken)?.size ?? 0) > 1 && owner.get(a.checkoutToken) !== a.deviceId;
  const idsOf = (a: any) => {
    const t = buildIdentifiers({ email: a.email ?? undefined, phone: a.phone ?? undefined, firstName: a.firstName ?? undefined, lastName: a.lastName ?? undefined, address1: a.address1 ?? undefined, city: a.city ?? undefined, reason: "other" } as any, a.country || shop.country)
      .filter((i) => LINK.includes(i.kind) || i.kind === "name_address").map((i) => ({ kind: i.kind, hash: hmacId(SECRET, i.kind, i.normalized) }));
    const d = normDevice(a.deviceId);
    return d ? [...t, { kind: "device" as IdKind, hash: hmacId(SECRET, "device", d) }] : t;
  };
  const per = attempts.map(idsOf);

  // replay to a fixed point with clean steps only (more permissive than the live rule → removes only what nothing supports)
  const sets = new Map<string, Set<string>>();
  for (const e of entries) sets.set(e.id, new Set(e.identifiers.filter((i: any) => !isAuto(e, i)).map((i: any) => i.hash)));
  const byAge = [...entries].sort((x, y) => +x.createdAt - +y.createdAt);
  const rank = new Map(byAge.map((e, k) => [e.id, k]));
  const owner2 = new Map<string, string>(); // hash → oldest entry holding it
  const own = (h: string, id: string) => { const c = owner2.get(h); if (!c || rank.get(id)! < rank.get(c)!) owner2.set(h, id); };
  for (const [id, s] of sets) for (const h of s) own(h, id);
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    attempts.forEach((a, k) => {
      if (tainted(a)) return;
      let best: string | null = null;
      for (const i of per[k]) { const c = owner2.get(i.hash); if (c && (!best || rank.get(c)! < rank.get(best)!)) best = c; }
      if (!best) return;
      const e = byAge[rank.get(best)!], s = sets.get(best)!;
      for (const i of per[k]) if ((i.kind === "device" || (LINK.includes(i.kind) && +a.createdAt >= +e.createdAt)) && !s.has(i.hash)) { s.add(i.hash); own(i.hash, best); changed = true; }
    });
    if (!changed) break;
  }
  const remove: { entryId: string; id: string; kind: string; raw: string; hash: string }[] = [];
  for (const e of entries) for (const i of e.identifiers) if (isAuto(e, i) && !sets.get(e.id)!.has(i.hash)) remove.push({ entryId: e.id, id: i.id, kind: i.kind, raw: i.raw, hash: i.hash });
  const gone = new Set(remove.map((r) => r.id));

  // last 3 days: browsers that reached checkout while matching the list (blocked), and whether only false data matched
  const since = Date.now() - 3 * DAY;
  const active = entries.filter((e) => !e.expiresAt || +e.expiresAt > Date.now());
  const idByHash = new Map<string, any[]>();
  for (const e of active) for (const i of e.identifiers) if (["email", "phone", "address", "device"].includes(i.kind)) { const l = idByHash.get(i.hash) ?? []; l.push(i); idByHash.set(i.hash, l); }
  type P = { dev: string; name: string; phone: string; city: string; last: Date; tries: number; done: boolean; anyReal: boolean; anyHit: boolean };
  const people = new Map<string, P>();
  attempts.forEach((a, k) => {
    if (+a.createdAt < since) return;
    const p: P = people.get(a.deviceId) ?? { dev: a.deviceId.slice(0, 6), name: "", phone: "", city: "", last: a.createdAt, tries: 0, done: false, anyReal: false, anyHit: false };
    p.tries++; p.last = a.createdAt;
    if (a.firstName || a.lastName) p.name = [a.firstName, a.lastName].filter(Boolean).join(" ");
    if (a.phone) p.phone = a.phone; if (a.city) p.city = a.city;
    if (a.event === "completed" || a.orderId) p.done = true;
    for (const i of per[k]) for (const row of idByHash.get(i.hash) ?? []) if (+row.createdAt <= +a.createdAt + 5000) { p.anyHit = true; if (!gone.has(row.id)) p.anyReal = true; }
    people.set(a.deviceId, p);
  });
  const blocked = [...people.values()].filter((p) => p.anyHit && !p.done);
  const falseBlocked = blocked.filter((p) => !p.anyReal);

  const lines = [
    `shared checkout tokens: ${[...devsOf.values()].filter((s) => s.size > 1).length} | tainted steps: ${attempts.filter(tainted).length}`,
    `auto-linked identifiers to remove: ${remove.length} (on ${new Set(remove.map((r) => r.entryId)).size} entries) — ${["device", "email", "phone", "address"].map((k) => `${k} ${remove.filter((r) => r.kind === k).length}`).join(", ")}`,
    `LAST 3 DAYS: blocked browsers (matched list, no order) ${blocked.length} | blocked ONLY because of false links ${falseBlocked.length}`,
    ...falseBlocked.sort((x, y) => +y.last - +x.last).map((p) => `  FALSE ${p.last.toISOString().slice(0, 16)} dev:${p.dev} ${p.name || "-"} | ${p.phone || "-"} | ${p.city || "-"} | tries ${p.tries}`),
    ...blocked.filter((p) => p.anyReal).sort((x, y) => +y.last - +x.last).map((p) => `  real  ${p.last.toISOString().slice(0, 16)} dev:${p.dev} ${p.name || "-"} | ${p.city || "-"} | tries ${p.tries}`),
    "--- to remove ---",
    ...remove.map((r) => `${r.entryId.slice(-6)} ${r.kind} ${r.kind === "device" ? r.raw.slice(0, 6) : r.raw}`),
  ];

  if (apply && remove.length) {
    await db.identifier.deleteMany({ where: { id: { in: remove.map((r) => r.id) } } });
    await unshareFromNetwork(shop.domain, remove.map((r) => r.hash)).catch(() => {});
    for (const id of new Set(remove.map((r) => r.entryId))) {
      await db.auditLog.create({ data: { shopId: shop.id, actor: "semafor:fix-shared-checkout-link", action: "entry.remove_data", entryId: id, payload: { removed: remove.filter((r) => r.entryId === id).map((r) => ({ kind: r.kind, raw: r.raw })) } as any } });
    }
    await pushCheckoutMetafield(admin as any, shop.id);
    lines.unshift(`APPLIED: removed ${remove.length}, blocklist pushed`);
  }
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
