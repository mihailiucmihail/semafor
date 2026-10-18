import type { ActionFunctionArgs } from "@remix-run/node";

/**
 * Admin page speed, measured in the merchant's browser (app/components/vitals.ts) and written to the server log
 * as one "[vitals]" line per page view: load time (LCP) and the slowest click / key press (INP) with what was clicked.
 * Nothing is stored; no customer data is sent (only the admin path and a short element description).
 */
const hits = new Map<string, { n: number; t: number }>();
const cut = (v: unknown, n = 120) => (typeof v === "string" ? v.slice(0, n) : typeof v === "number" && isFinite(v) ? Math.round(v) : null);

export const action = async ({ request }: ActionFunctionArgs) => {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const now = Date.now(); const h = hits.get(ip);
  if (h && now - h.t < 600_000) { if (++h.n > 200) return new Response(null, { status: 429 }); } else hits.set(ip, { n: 1, t: now });
  let b: any;
  try { b = JSON.parse((await request.text()).slice(0, 4000)); } catch { return new Response(null, { status: 400 }); }
  const line = {
    path: cut(b.path, 60), nav: cut(b.nav, 12), ttfb: cut(b.ttfb), fcp: cut(b.fcp), lcp: cut(b.lcp), lcpEl: cut(b.lcpEl),
    inp: cut(b.inp), inpType: cut(b.inpType, 20), inpEl: cut(b.inpEl), inDelay: cut(b.inDelay), proc: cut(b.proc), pres: cut(b.pres),
    longTasks: cut(b.longTasks), longest: cut(b.longest),
    redirect: cut(b.redirect), redirects: cut(b.redirects), dns: cut(b.dns), connect: cut(b.connect), tls: cut(b.tls),
    beforeReq: cut(b.beforeReq), wait: cut(b.wait), download: cut(b.download),
  };
  console.log("[vitals]", JSON.stringify(line));
  return new Response(null, { status: 204 });
};
