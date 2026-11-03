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
  // ?dev=<prefix>: every checkout step + every e-mail Semafor sent for one browser (compact lines)
  const devQ = new URL(request.url).searchParams.get("dev");
  // ?email=<exact>: every step that typed this e-mail, on which browser / checkout / IP / fingerprint,
  // and how many browsers share each checkout token (a shared token = a link opened on several browsers)
  // ?leaks=1: sent e-mails whose checkout link points to a DIFFERENT checkout than the recipient's own
  if (new URL(request.url).searchParams.get("leaks")) {
    const sends = (await db.emailSend.findMany({ where: { shopId: shop.id, status: "sent" }, orderBy: { createdAt: "asc" }, select: { createdAt: true, kind: true, deviceId: true, checkoutToken: true, html: true } })) as any[];
    const byLink = new Map<string, { devs: Set<string>; at: string[] }>();
    let cart = 0;
    for (const s of sends) {
      const t = String(s.html || "").match(/\/checkouts\/(?:ac|cn|c)\/([A-Za-z0-9_-]+)/)?.[1];
      if (!t) { cart++; continue; }
      if (!byLink.has(t)) byLink.set(t, { devs: new Set(), at: [] });
      byLink.get(t)!.devs.add((s.deviceId || "-").slice(0, 6)); byLink.get(t)!.at.push(s.createdAt.toISOString().slice(0, 16));
    }
    const shared = [...byLink.entries()].filter(([, v]) => v.devs.size > 1);
    const wrong = shared.reduce((n, [, v]) => n + v.devs.size - 1, 0), ok = sends.length - cart;
    const out = shared.map(([k, v]) => `link ${k.slice(0, 8)} → ${v.devs.size} browsers (${[...v.devs].join(",")}) ${v.at[0]}…${v.at[v.at.length - 1]}`);
    return new Response([`sent ${sends.length} | checkout links ${ok} | links shared by several browsers ${shared.length} (≥${wrong} went to a stranger) | cart link ${cart}`, ...out].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const emQ = new URL(request.url).searchParams.get("email");
  if (emQ) {
    const rows = (await db.checkoutAttempt.findMany({ where: { shopId: shop.id, email: { equals: emQ, mode: "insensitive" } }, orderBy: { createdAt: "asc" }, take: 1000,
      select: { deviceId: true, event: true, phone: true, firstName: true, lastName: true, city: true, checkoutToken: true, ip: true, fingerprint: true, discountCode: true, createdAt: true } })) as any[];
    const toks = [...new Set(rows.map((r) => r.checkoutToken).filter(Boolean))];
    const tokRows = toks.length ? ((await db.checkoutAttempt.findMany({ where: { shopId: shop.id, checkoutToken: { in: toks } }, select: { checkoutToken: true, deviceId: true, email: true } })) as any[]) : [];
    const byTok = new Map<string, { devs: Set<string>; emails: Set<string> }>();
    for (const t of tokRows) { const k = t.checkoutToken; if (!byTok.has(k)) byTok.set(k, { devs: new Set(), emails: new Set() }); byTok.get(k)!.devs.add((t.deviceId || "-").slice(0, 6)); if (t.email) byTok.get(k)!.emails.add(t.email); }
    const lines = [
      ...rows.map((r) => `${r.createdAt.toISOString().slice(0, 16)} dev:${(r.deviceId || "-").slice(0, 6)} ${r.event.padEnd(9)} ${r.phone || "-"} | ${[r.firstName, r.lastName].filter(Boolean).join(" ") || "-"} | ${r.city || "-"} | ck:${(r.checkoutToken || "-").slice(0, 8)} | ip:${(r.ip || "-").slice(0, 15)} | fp:${(r.fingerprint || "-").slice(0, 6)} | ${r.discountCode || ""}`),
      "--- per checkout token: browsers / e-mails ---",
      ...[...byTok.entries()].map(([k, v]) => `ck:${k.slice(0, 8)} browsers:${[...v.devs].join(",")} emails:${[...v.emails].join(",")}`),
    ];
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (devQ) {
    const rows = (await db.checkoutAttempt.findMany({ where: { shopId: shop.id, deviceId: { startsWith: devQ } }, orderBy: { createdAt: "asc" }, take: 400,
      select: { deviceId: true, event: true, email: true, phone: true, firstName: true, lastName: true, city: true, checkoutToken: true, host: true, discountCode: true, total: true, ip: true, fingerprint: true, createdAt: true } })) as any[];
    const devs = [...new Set(rows.map((r) => r.deviceId))];
    const sends = devs.length ? ((await db.emailSend.findMany({ where: { shopId: shop.id, deviceId: { in: devs } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, kind: true, email: true, status: true, checkoutToken: true } })) as any[]) : [];
    const leads = devs.length ? ((await db.popupLead.findMany({ where: { shopId: shop.id, deviceId: { in: devs } }, select: { createdAt: true, email: true, source: true } })) as any[]) : [];
    const lines = [
      ...rows.map((r) => `${r.createdAt.toISOString().slice(0, 16)} ${r.event.padEnd(9)} ${r.email || "-"} | ${r.phone || "-"} | ${[r.firstName, r.lastName].filter(Boolean).join(" ") || "-"} | ${r.city || "-"} | ck:${(r.checkoutToken || "-").slice(0, 8)} | ip:${(r.ip || "-").slice(0, 15)} | fp:${(r.fingerprint || "-").slice(0, 6)} | ${r.discountCode || ""} ${r.total ?? ""}`),
      "--- e-mails sent to this browser ---",
      ...sends.map((s) => `${s.createdAt.toISOString().slice(0, 16)} ${s.kind} ${s.status} → ${s.email} ck:${(s.checkoutToken || "-").slice(0, 8)}`),
      "--- pop-up leads ---",
      ...leads.map((l) => `${l.createdAt.toISOString().slice(0, 16)} ${l.source} ${l.email}`),
    ];
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
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
