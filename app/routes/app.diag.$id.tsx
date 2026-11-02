// Diagnostic (admin only, read-only): how a blacklist entry grew — every identifier with the time it was added,
// every audit event, and for each automatic device link the checkout steps of that browser with the
// identifiers that were ALREADY on the entry and matched (= the trigger of the link).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop, SECRET } from "../semafor/shop.server";
import { buildIdentifiers } from "../semafor/entries.server";
import { hmacId } from "../../core/hash";
import { normDevice } from "../../core/normalize";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const entry = await db.blockEntry.findFirst({ where: { id: params.id, shopId: shop.id }, select: { id: true, reason: true, createdAt: true } });
  if (!entry) return new Response("not found", { status: 404 });
  const ids = await db.identifier.findMany({ where: { entryId: entry.id }, orderBy: { createdAt: "asc" }, select: { kind: true, raw: true, hash: true, createdAt: true } });
  const audits = (await db.auditLog.findMany({ where: { shopId: shop.id, entryId: entry.id }, orderBy: { at: "asc" }, select: { action: true, actor: true, at: true, payload: true } })) as any[];
  const devices = [...new Set(ids.filter((i) => i.kind === "device").map((i) => i.raw))];
  const attempts = devices.length ? ((await db.checkoutAttempt.findMany({
    where: { shopId: shop.id, deviceId: { in: devices }, event: { not: "cart" } }, orderBy: { createdAt: "asc" }, take: 3000,
    select: { deviceId: true, event: true, email: true, phone: true, firstName: true, lastName: true, address1: true, city: true, country: true, createdAt: true },
  })) as any[]) : [];
  const idAt = new Map(ids.map((i) => [i.hash, i]));
  const short = (d: string) => (normDevice(d) || d).slice(0, 6);
  // first matching step per device: what the browser typed that was already on the entry at that moment
  const triggers = devices.map((dev) => {
    const devId = ids.find((i) => i.kind === "device" && i.raw === dev)!;
    for (const a of attempts.filter((x) => x.deviceId === dev)) {
      const typed = buildIdentifiers({ email: a.email ?? undefined, phone: a.phone ?? undefined, firstName: a.firstName ?? undefined, lastName: a.lastName ?? undefined, address1: a.address1 ?? undefined, city: a.city ?? undefined, reason: "other" } as any, a.country || shop.country);
      const hit = typed.map((t) => ({ t, row: idAt.get(hmacId(SECRET, t.kind, t.normalized)) })).filter((x) => x.row && +x.row.createdAt <= +a.createdAt + 5000);
      if (hit.length) return { device: short(dev), linkedAt: devId.createdAt, stepAt: a.createdAt, typed: [a.email, a.phone, [a.firstName, a.lastName].filter(Boolean).join(" "), a.address1, a.city].filter(Boolean).join(" · "), matchedOn: hit.map((x) => `${x.t.kind}: ${x.row!.raw} (on list since ${x.row!.createdAt.toISOString()})`) };
    }
    return { device: short(dev), linkedAt: devId.createdAt, stepAt: null, typed: null, matchedOn: ["(no checkout step of this browser matched — linked by backfill or from an order)"] };
  });
  // what each browser typed over time (who used it)
  const perDevice = devices.map((dev) => {
    const list = attempts.filter((a) => a.deviceId === dev);
    const uniq = (f: (a: any) => any) => [...new Set(list.map(f).filter(Boolean))];
    return { device: short(dev), steps: list.length, first: list[0]?.createdAt ?? null, last: list[list.length - 1]?.createdAt ?? null,
      emails: uniq((a) => a.email), phones: uniq((a) => a.phone), names: uniq((a) => [a.firstName, a.lastName].filter(Boolean).join(" ")), cities: uniq((a) => a.city) };
  });
  const out = {
    perDevice,
    entry,
    identifiers: ids.map((i) => ({ at: i.createdAt, kind: i.kind, raw: i.kind === "device" ? short(i.raw) : i.raw })),
    audits: audits.map((a) => ({ at: a.at, action: a.action, actor: a.actor, added: (a.payload?.added || a.payload?.removed || []).map((x: any) => `${x.kind}: ${x.kind === "device" ? short(x.raw) : x.raw}`) })),
    deviceTriggers: triggers.sort((x, y) => +new Date(x.linkedAt) - +new Date(y.linkedAt)),
  };
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
