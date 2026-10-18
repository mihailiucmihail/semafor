// Retention (privacy policy + kastellabs.com/semafor/data): run once a day by the app scheduler.
//   checkout steps (CheckoutAttempt)        120 days
//   order checks (OrderCheck) + DeviceEvent  12 months
//   activity log (AuditLog)                  12 months (it holds raw values the merchant added / removed)
//   network reports (NetworkReport)          until expiresAt (24 months after the report)
// Blacklist entries are the merchant's own list: kept until the merchant deletes them (or uninstalls).
// Deletes in batches by id so a big backlog never holds one long lock.

export const DAY = 86_400_000;
export const RETENTION = { attemptsDays: 120, checksDays: 365, auditDays: 365 } as const;

export function cutoffs(now: Date) {
  return {
    attempts: new Date(now.getTime() - RETENTION.attemptsDays * DAY),
    checks: new Date(now.getTime() - RETENTION.checksDays * DAY),
    audit: new Date(now.getTime() - RETENTION.auditDays * DAY),
    network: now,
  };
}

const BATCH = 2000;
async function purge(model: any, where: Record<string, unknown>): Promise<number> {
  let n = 0;
  for (;;) {
    const rows: Array<{ id: string }> = await model.findMany({ where, select: { id: true }, take: BATCH });
    if (!rows.length) return n;
    n += (await model.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })).count;
    if (rows.length < BATCH) return n;
  }
}

export interface RetentionResult { attempts: number; orderChecks: number; deviceEvents: number; audit: number; network: number }

export async function runRetention(db: any, now = new Date()): Promise<RetentionResult> {
  const c = cutoffs(now);
  return {
    attempts: await purge(db.checkoutAttempt, { createdAt: { lt: c.attempts } }),
    orderChecks: await purge(db.orderCheck, { checkedAt: { lt: c.checks } }),
    deviceEvents: await purge(db.deviceEvent, { seenAt: { lt: c.checks } }),
    audit: await purge(db.auditLog, { at: { lt: c.audit } }),
    network: await purge(db.networkReport, { expiresAt: { lt: c.network } }),
  };
}

/** AppKv key that marks "retention already ran today" (created once; both deployments share the database). */
export const retentionKey = (now = new Date()) => `retention:${now.toISOString().slice(0, 10)}`;
