import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import db from "../db.server";

/**
 * Funnel counters for kastellabs.com landing pages (no personal data, no cookies, no IP stored):
 *   POST {e:"landing"|"install_click", c:<utm_content>, k:<utm_campaign>, p:<page path>}
 *   → increments AppKv "clk:<YYYY-MM-DD>:<event>:<campaign>:<content>".
 *   GET ?days=14 → JSON totals per day / event / campaign / content (aggregate counts only).
 * Lets us see, per reel (utm_content), how many people landed and how many clicked "Install".
 */
const hits = new Map<string, { n: number; t: number }>();
const EVENTS = new Set(["landing", "install_click"]);
const clean = (v: unknown) => (typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9_\-.]/g, "").slice(0, 40) : "") || "-";
const CORS = { "Access-Control-Allow-Origin": "*" };

export const action = async ({ request }: ActionFunctionArgs) => {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const now = Date.now(); const h = hits.get(ip);
  if (h && now - h.t < 600_000) { if (++h.n > 60) return new Response(null, { status: 429, headers: CORS }); } else hits.set(ip, { n: 1, t: now });
  if (hits.size > 5000) hits.clear();
  let b: any;
  try { b = JSON.parse((await request.text()).slice(0, 1000)); } catch { return new Response(null, { status: 400, headers: CORS }); }
  const e = String(b?.e || "");
  if (!EVENTS.has(e)) return new Response(null, { status: 400, headers: CORS });
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `clk:${day}:${e}:${clean(b.k)}:${clean(b.c)}`;
  try {
    await db.$executeRaw`INSERT INTO "AppKv" ("key","value","updatedAt") VALUES (${key}, '1', NOW())
      ON CONFLICT ("key") DO UPDATE SET "value" = (CAST("AppKv"."value" AS INTEGER) + 1)::text, "updatedAt" = NOW()`;
  } catch (err) { console.error("[click]", err); }
  return new Response(null, { status: 204, headers: CORS });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 14));
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.appKv.findMany({ where: { key: { startsWith: "clk:" } }, select: { key: true, value: true } });
  const out = rows
    .map((r) => { const [, day, event, campaign, content] = r.key.split(":"); return { day, event, campaign, content, n: Number(r.value) || 0 }; })
    .filter((r) => r.day >= from)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.content.localeCompare(b.content)));
  return new Response(JSON.stringify({ days, rows: out }), { headers: { "Content-Type": "application/json", ...CORS } });
};
