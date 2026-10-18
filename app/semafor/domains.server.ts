/**
 * Self-serve "send from your own domain": the merchant adds the domain to Semafor's Resend account (region eu-west-1),
 * copies the DNS records shown, and verifies. Merchants never see the Resend account.
 *
 * Security:
 *  - a shop manages only the Resend domain id stored on its own settings (settings.sendingDomain);
 *  - a domain linked to another shop can't be added; a domain that already exists in the Resend account without
 *    being linked to this shop can only be linked by the owner's stores (mihailiuc.ro was verified before this);
 *  - public mailbox domains and *.myshopify.com are refused;
 *  - senderOf() uses an own address only when its domain is verified AND linked to the sending shop.
 */
import db from "../db.server";
import type { DnsRecord, SendingDomain, ShopSettings } from "../../core/settings";
import { saveSettings } from "./shop.server";
import { invalidateVerified } from "./recovery.server";
import { isOwnerShop } from "./plan.server";

const API = "https://api.resend.com";
const REGION = "eu-west-1";

import { cleanDomain, checkDomainAllowed } from "../../core/domain";
export { cleanDomain, checkDomainAllowed };
export type DomainError = "invalid" | "public" | "shopify" | "taken" | "exists" | "noKey" | "api" | "limit";
export class DomainProblem extends Error { constructor(public code: DomainError, msg?: string) { super(msg || code); } }

async function resend(path: string, init: RequestInit = {}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new DomainProblem("noKey");
  const r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const j: any = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

function toState(j: any, prev?: SendingDomain | null): SendingDomain {
  const records: DnsRecord[] = ((j?.records ?? prev?.records ?? []) as any[]).map((x) => ({
    record: x.record ?? null, type: String(x.type || ""), name: String(x.name || ""), value: String(x.value || ""),
    priority: x.priority ?? null, ttl: x.ttl ?? "Auto", status: x.status ?? null,
  }));
  return { id: String(j?.id || prev?.id || ""), name: String(j?.name || prev?.name || "").toLowerCase(), status: String(j?.status || prev?.status || "not_started"), records, checkedAt: new Date().toISOString() };
}

/** Shop (other than `shopId`) that already linked this domain. */
async function claimedBy(name: string, shopId: string) {
  const rows = (await db.$queryRaw`SELECT "id" FROM "Shop" WHERE "settings"->'sendingDomain'->>'name' = ${name} AND "id" <> ${shopId} LIMIT 1`) as any[];
  return rows.length > 0;
}

async function store(shop: { id: string }, d: SendingDomain | null, actor: string) {
  return saveSettings(shop.id, { sendingDomain: d } as Partial<ShopSettings>, actor);
}

/** Step 1: add (or, for the same shop / the owner, reuse) the domain in Semafor's Resend account. */
export async function connectDomain(shop: { id: string; domain: string; settings: ShopSettings }, input: string, actor: string) {
  const name = cleanDomain(input);
  if (!name) throw new DomainProblem("invalid");
  const bad = checkDomainAllowed(name);
  if (bad) throw new DomainProblem(bad);
  if (await claimedBy(name, shop.id)) throw new DomainProblem("taken");
  const cur = shop.settings.sendingDomain;
  if (cur?.id && cur.name === name) return refreshDomain(shop, actor);
  if (cur?.id && cur.name !== name) await disconnectDomain(shop, actor); // switching to another domain
  const r = await resend("/domains", { method: "POST", body: JSON.stringify({ name, region: REGION }) });
  if (r.ok) {
    const st = toState(r.j);
    await store(shop, st, actor);
    return st;
  }
  const msg = String(r.j?.message || r.j?.name || "");
  if (r.status === 409 || /already|exists|registered/i.test(msg)) {
    // already in our Resend account and not linked to another shop. Not verified → anyone may take it over (they still
    // have to prove DNS control). Verified → only the shop that unlinked it earlier, or the owner's stores.
    const list = await resend("/domains");
    const found = ((list.j?.data ?? []) as any[]).find((x) => String(x.name).toLowerCase() === name);
    if (!found) throw new DomainProblem("api", msg);
    if (found.status === "verified" && !isOwnerShop(shop.domain) && shop.settings.sendingDomainPrev !== name) throw new DomainProblem("exists");
    const one = await resend(`/domains/${encodeURIComponent(found.id)}`);
    const st = toState(one.ok ? one.j : found);
    await store(shop, st, actor);
    return st;
  }
  if (/domain limit/i.test(msg)) {
    console.error("[semafor] Resend domain limit reached — upgrade the Resend plan", { shop: shop.domain, name });
    throw new DomainProblem("limit", msg);
  }
  throw new DomainProblem("api", `Resend ${r.status}: ${msg || JSON.stringify(r.j).slice(0, 200)}`);
}

/** Current status + DNS records (only the domain linked to this shop). */
export async function refreshDomain(shop: { id: string; settings: ShopSettings }, actor = "system") {
  const cur = shop.settings.sendingDomain;
  if (!cur?.id) return null;
  const r = await resend(`/domains/${encodeURIComponent(cur.id)}`);
  if (!r.ok) {
    if (r.status === 404) { await store(shop, null, actor); return null; }
    throw new DomainProblem("api", `Resend ${r.status}: ${r.j?.message || ""}`);
  }
  const st = toState(r.j, cur);
  if (st.status === "verified" && cur.status !== "verified") invalidateVerified();
  await store(shop, st, actor);
  return st;
}

/** "Verify now": asks Resend to check the DNS again, then reads the status. */
export async function verifyDomain(shop: { id: string; settings: ShopSettings }, actor: string) {
  const cur = shop.settings.sendingDomain;
  if (!cur?.id) return null;
  await resend(`/domains/${encodeURIComponent(cur.id)}/verify`, { method: "POST" });
  await new Promise((r) => setTimeout(r, 1500));
  const st = await refreshDomain(shop, actor);
  invalidateVerified();
  return st;
}

/**
 * Unlink the domain from the shop. It is deleted from Resend only when it is not verified and no other shop uses it
 * (a verified domain stays, so nothing that already works can break; it can be linked again by this shop).
 */
export async function disconnectDomain(shop: { id: string; domain: string; settings: ShopSettings }, actor: string) {
  const cur = shop.settings.sendingDomain;
  if (cur?.id && cur.status !== "verified" && !isOwnerShop(shop.domain) && !(await claimedBy(cur.name, shop.id))) {
    await resend(`/domains/${encodeURIComponent(cur.id)}`, { method: "DELETE" }).catch(() => null);
  }
  await saveSettings(shop.id, { sendingDomain: null, sendingDomainPrev: cur?.status === "verified" ? cur.name : shop.settings.sendingDomainPrev ?? null } as Partial<ShopSettings>, actor);
  invalidateVerified();
}

/** Shop's primary storefront host without www (suggestion for the domain field). */
export async function primaryHost(admin: { graphql: (q: string) => Promise<Response> }) {
  try {
    const j: any = await (await admin.graphql(`query { shop { primaryDomain { host } } }`)).json();
    const h = cleanDomain(j?.data?.shop?.primaryDomain?.host || "");
    return h && !checkDomainAllowed(h) ? h : "";
  } catch { return ""; }
}

/** Where the domain's DNS is managed, from its nameservers — the guide then shows that provider's steps.
 *  Keys match the order of DOMAIN_GUIDE[lang].providers. */
export type DnsHost = "shopify" | "cloudflare" | "godaddy" | "namecheap" | "ro" | "squarespace" | "other";
export async function dnsHostOf(name: string): Promise<{ host: DnsHost; ns: string[] }> {
  const { promises: dns } = await import("node:dns");
  const parts = name.toLowerCase().split(".");
  let ns: string[] = [];
  // the domain itself, then its parent (a subdomain has no NS of its own)
  for (let i = 0; i < Math.min(2, parts.length - 1) && !ns.length; i++) {
    const d = parts.slice(i).join(".");
    ns = await Promise.race([dns.resolveNs(d).catch(() => [] as string[]), new Promise<string[]>((r) => setTimeout(() => r([]), 2500))]);
  }
  const all = ns.map((x) => x.toLowerCase()).join(" ");
  const host: DnsHost =
    // domains bought through Shopify use Google Cloud DNS (ns-cloud-xN.googledomains.com)
    /shopify|ns-cloud-[a-e]\d+\.googledomains\.com/.test(all) ? "shopify"
    : /cloudflare\.com/.test(all) ? "cloudflare"
    : /domaincontrol\.com/.test(all) ? "godaddy"
    : /registrar-servers\.com|namecheaphosting/.test(all) ? "namecheap"
    : /googledomains\.com|squarespace/.test(all) ? "squarespace"
    : /romarg|hostico|claus|cyberfolks|zooku|rotld|hostway|\.ro(\s|$)/.test(all) ? "ro"
    : "other";
  return { host, ns };
}
