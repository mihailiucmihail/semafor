// E-mails the owner when a real store installs (or reinstalls / uninstalls) Semafor.
// Owner and test stores are skipped; one mail per store, event and day (deduped in AppKv, shared by both deployments).
import db from "../db.server";
import { isOwnerShop } from "./plan.server";

const TEST_SHOPS = (process.env.SEMAFOR_PRO_SHOPS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const isTest = (d: string) => isOwnerShop(d) || TEST_SHOPS.includes(d.toLowerCase()) || /test|dev|demo|review/i.test(d);
const esc = (s: string) => s.replace(/[<>&"]/g, "");

type Kind = "install" | "reinstall" | "uninstall";

async function shopInfo(domain: string, token: string) {
  if (!token) return null;
  try {
    const r = await fetch(`https://${domain}/admin/api/2026-07/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `query{ shop{ name plan{ displayName } billingAddress{ countryCodeV2 } } }` }),
    });
    const j: any = await r.json();
    const s = j?.data?.shop;
    return s ? { name: String(s.name || ""), plan: String(s.plan?.displayName || ""), country: String(s.billingAddress?.countryCodeV2 || "") } : null;
  } catch { return null; }
}

async function counts() {
  const all = await db.shop.findMany({ select: { domain: true, uninstalledAt: true, plan: true } });
  const real = all.filter((s) => !isTest(s.domain));
  const active = real.filter((s) => !s.uninstalledAt);
  return { active: active.length, paying: active.filter((s) => s.plan === "basic" || s.plan === "pro").length, ever: real.length };
}

/** Fire-and-forget: never throws, never blocks the request that triggered it. */
export function notifyInstall(kind: Kind, domain: string, token = "") {
  void (async () => {
    if (isTest(domain)) return;
    const to = process.env.INSTALL_NOTIFY_EMAIL || process.env.LAUNCH_OFFER_EMAIL || process.env.QUOTA_ALERT_EMAIL || "mihailiucmihail@gmail.com";
    if (!process.env.RESEND_API_KEY || to === "off") return;
    const day = new Date().toISOString().slice(0, 10);
    const fresh = await db.appKv.create({ data: { key: `install-mail:${kind}:${domain}:${day}`, value: new Date().toISOString() } }).then(() => true, () => false);
    if (!fresh) return;
    const [info, c] = await Promise.all([kind === "uninstall" ? null : shopInfo(domain, token), counts()]);
    const title = kind === "uninstall" ? "Магазин удалил Semafor" : kind === "reinstall" ? "Магазин снова установил Semafor" : "Новая установка Semafor";
    const color = kind === "uninstall" ? "#b42318" : "#12271D";
    const rows = [
      ["Магазин", `<b>${esc(info?.name || domain)}</b>`],
      ["Домен", esc(domain)],
      ...(info?.country ? [["Страна", esc(info.country)]] : []),
      ...(info?.plan ? [["Тариф Shopify", esc(info.plan)]] : []),
      ["Сейчас активных магазинов", String(c.active)],
      ["Из них платят", String(c.paying)],
    ];
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">
<h2 style="margin:0 0 12px;color:${color}">${title}</h2>
<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#616161">${k}</td><td style="padding:4px 0">${v}</td></tr>`).join("")}</table>
<p style="margin-top:16px"><a href="https://admin.shopify.com/store/1nbnns-by/apps/semafor/app/funnel" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Открыть воронку</a></p></div>`;
    const { sendMail } = await import("./recovery.server");
    const from = `alerts@${process.env.SEMAFOR_MAIL_DOMAIN || "semafor.kastelmail.com"}`;
    await sendMail({ to, subject: `Semafor: ${title.toLowerCase()} — ${info?.name || domain}`, html, fromName: "Semafor", fromEmail: from });
  })().catch((e) => console.error("[semafor] install notify", e));
}
