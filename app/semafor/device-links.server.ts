import type { PrismaClient } from "@prisma/client";
import { buildIdentifiers } from "./entries.server";
import { hmacId } from "../../core/hash";
import { normEmail, normPhone, normName } from "../../core/normalize";

export type DeviceFinding = { kind: "device"; normalized: string; entryId: string; reason: string; weight: number };

const DAY = 86_400_000;

/**
 * Looks at every checkout attempt made from the same device as this order (same browser id,
 * or same device fingerprint on the same IP) during the last 30 days.
 *  - if any identity tried from that device is on the blacklist → red (weight 100)
 *  - if the device cycled through several identities within 48 h → yellow (weight 40)
 */
export async function deviceLinks(db: PrismaClient, secret: string, shopId: string, checkoutToken: string | null | undefined, country = "RO", ro = true) {
  if (!checkoutToken) return { findings: [] as DeviceFinding[], identities: [] as string[] };
  const seed = await db.checkoutAttempt.findMany({ where: { shopId, checkoutToken }, select: { deviceId: true, fingerprint: true, ip: true } }) as any[];
  if (!seed.length) return { findings: [], identities: [] };

  const devices = [...new Set(seed.map((s: any) => s.deviceId as string))];
  const fpIp = seed.filter((s: any) => s.fingerprint && s.ip).map((s: any) => ({ fingerprint: s.fingerprint!, ip: s.ip! }));
  const since = new Date(Date.now() - 30 * DAY);
  const attempts = await db.checkoutAttempt.findMany({
    where: { shopId, createdAt: { gt: since }, OR: [{ deviceId: { in: devices } }, ...fpIp.map((x: any) => ({ fingerprint: x.fingerprint, ip: x.ip }))] },
    orderBy: { createdAt: "asc" },
  }) as any[];

  // distinct identities used from this device
  const emails = new Map<string, string>(), phones = new Map<string, string>(), names = new Map<string, string>();
  for (const a of attempts) {
    const e = a.email && normEmail(a.email); if (e) emails.set(e, a.email!);
    const p = a.phone && normPhone(a.phone, country); if (p) phones.set(p, a.phone!);
    const n = normName(a.firstName, a.lastName); if (n) names.set(n, [a.firstName, a.lastName].filter(Boolean).join(" "));
  }
  const identities = [...emails.values(), ...phones.values(), ...names.values()];
  const findings: DeviceFinding[] = [];

  // blacklisted identity tried from this device
  const seen = new Set<string>();
  for (const a of attempts) {
    const ids = buildIdentifiers({ email: a.email ?? undefined, phone: a.phone ?? undefined, firstName: a.firstName ?? undefined, lastName: a.lastName ?? undefined, address1: a.address1 ?? undefined, city: a.city ?? undefined, reason: "other" }, country)
      .filter((i) => i.kind === "email" || i.kind === "phone" || i.kind === "name_address" || i.kind === "address");
    for (const i of ids) {
      const key = `${i.kind}:${i.normalized}`; if (seen.has(key)) continue; seen.add(key);
      const row = await db.identifier.findFirst({ where: { shopId, kind: i.kind as any, hash: hmacId(secret, i.kind, i.normalized) }, include: { entry: { select: { id: true, reason: true, expiresAt: true } } } }) as any;
      if (!row || (row.entry.expiresAt && row.entry.expiresAt < new Date())) continue;
      const strong = i.kind !== "address";
      findings.push({ kind: "device", normalized: ro ? `dispozitivul a încercat ${i.raw}` : `this device tried ${i.raw}`, entryId: row.entry.id, reason: row.entry.reason, weight: strong ? 100 : 60 });
    }
  }

  // identity hopping within 48 h
  const recent = attempts.filter((a) => a.createdAt.getTime() > Date.now() - 2 * DAY);
  const rE = new Set(recent.map((a) => a.email && normEmail(a.email)).filter(Boolean));
  const rP = new Set(recent.map((a) => a.phone && normPhone(a.phone, country)).filter(Boolean));
  const rN = new Set(recent.map((a) => normName(a.firstName, a.lastName)).filter(Boolean));
  if (rE.size >= 3 || rP.size >= 3 || rN.size >= 3 || rE.size + rP.size + rN.size >= 6) {
    findings.push({ kind: "device", normalized: ro ? `${rE.size} e-mailuri, ${rP.size} telefoane, ${rN.size} nume în 48 h de pe același dispozitiv` : `${rE.size} e-mails, ${rP.size} phones, ${rN.size} names in 48 h from the same device`, entryId: "", reason: ro ? "schimbă datele" : "changes identity", weight: 40 });
  }
  return { findings, identities };
}
