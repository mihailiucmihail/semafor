import db from "../db.server";

/**
 * Semafor sends every shop's e-mails through ONE Resend account, so the Resend plan limits are global.
 * Defaults = Resend Free (100/day, 3,000/month). After upgrading set RESEND_DAILY_LIMIT / RESEND_MONTHLY_LIMIT
 * (0 = no limit) on Railway.
 */
const num = (v: string | undefined, d: number) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
const DAY = 86_400_000;

export type MailQuota = { level: "ok" | "warn" | "full"; day: number; dayLimit: number; month: number; monthLimit: number; blocked: boolean };

let cache: { at: number; q: MailQuota } | null = null;

export async function mailQuota(): Promise<MailQuota> {
  if (cache && Date.now() - cache.at < 60_000) return cache.q;
  const dayLimit = num(process.env.RESEND_DAILY_LIMIT, 100);
  const monthLimit = num(process.env.RESEND_MONTHLY_LIMIT, 3000);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [day, month, blockedN] = await Promise.all([
    db.emailSend.count({ where: { status: "sent", createdAt: { gt: new Date(Date.now() - DAY) } } }),
    db.emailSend.count({ where: { status: "sent", createdAt: { gte: monthStart } } }),
    // Resend answers 429 "daily_quota_exceeded" / "monthly_quota_exceeded" once the plan is used up
    db.emailSend.count({ where: { status: "failed", createdAt: { gt: new Date(Date.now() - DAY) }, error: { contains: "quota", mode: "insensitive" } } }),
  ]);
  const ratio = Math.max(dayLimit ? day / dayLimit : 0, monthLimit ? month / monthLimit : 0);
  const blocked = blockedN > 0;
  const level = blocked || ratio >= 1 ? "full" : ratio >= 0.7 ? "warn" : "ok";
  const q = { level, day, dayLimit, month, monthLimit, blocked } as MailQuota;
  cache = { at: Date.now(), q };
  return q;
}

/**
 * E-mails the app owner once per UTC day per level ("warn" at 70 %, "full" when used up).
 * Recipient: QUOTA_ALERT_EMAIL (default: the owner's Gmail). Called after every send attempt; cheap (cached 60 s).
 */
export async function quotaAlert() {
  const to = process.env.QUOTA_ALERT_EMAIL || "mihailiucmihail@gmail.com";
  if (!process.env.RESEND_API_KEY || to === "off") return;
  cache = null;
  const q = await mailQuota();
  if (q.level === "ok") return;
  const key = `quota-alert:${new Date().toISOString().slice(0, 10)}:${q.level}`;
  const created = await db.appKv.create({ data: { key, value: JSON.stringify(q) } }).then(() => true, () => false);
  if (!created) return; // already alerted today for this level
  const { sendMail } = await import("./recovery.server");
  const full = q.level === "full";
  const subject = full ? "Semafor: limita Resend e epuizată — e-mailurile NU se mai trimit" : "Semafor: limita Resend se termină în curând";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">
<h2 style="margin:0 0 12px">${full ? "Limita de trimitere e epuizată" : "Limita de trimitere se apropie de final"}</h2>
<p>Ultimele 24 h: <b>${q.day}</b> din ${q.dayLimit || "∞"} e-mailuri.<br>Luna aceasta: <b>${q.month}</b> din ${q.monthLimit || "∞"}.</p>
<p>${full ? "E-mailurile de bun venit (codul din pop-up) și reamintirile nu mai pleacă până la resetarea limitei." : "Când limita se termină, e-mailurile cu codul din pop-up și reamintirile nu mai pleacă până a doua zi."}</p>
<p><a href="https://resend.com/settings/billing" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Treci pe Resend Pro (20 $/lună)</a></p>
<p style="color:#666;font-size:13px">După upgrade setează în Railway: RESEND_DAILY_LIMIT=0 și RESEND_MONTHLY_LIMIT=50000.</p></div>`;
  const from = `alerts@${process.env.SEMAFOR_MAIL_DOMAIN || "semafor.kastelmail.com"}`;
  await sendMail({ to, subject, html, fromName: "Semafor", fromEmail: from }).catch((e) => console.error("[semafor] quota alert", e));
}
