import type { LoaderFunctionArgs } from "@remix-run/node";

/**
 * Traffic-light image for the order block and the app pages.
 * /light/green | /light/yellow | /light/red   (?o=h for a horizontal light)
 * Active lamp: bright, with a glow. The other two: dark, but their colour still readable.
 */
const LAMPS = {
  red:    { on: ["#ff6b5e", "#e0201a", "#7a0d0a"], off: ["#5a2522", "#3a1715"] },
  yellow: { on: ["#ffe27a", "#f5b400", "#7a5600"], off: ["#5a4a1f", "#3a3014"] },
  green:  { on: ["#7dffa8", "#14c95a", "#05612a"], off: ["#1f4a30", "#14301f"] },
} as const;
type L = keyof typeof LAMPS;

function svg(active: L, horizontal: boolean) {
  const order: L[] = ["red", "yellow", "green"];
  const W = horizontal ? 260 : 100, H = horizontal ? 100 : 260;
  const defs = order.map((k) => {
    const c = LAMPS[k];
    return `
    <radialGradient id="on-${k}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".18" stop-color="${c.on[0]}"/><stop offset=".65" stop-color="${c.on[1]}"/><stop offset="1" stop-color="${c.on[2]}"/></radialGradient>
    <radialGradient id="off-${k}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="${c.off[0]}"/><stop offset="1" stop-color="${c.off[1]}"/></radialGradient>
    <radialGradient id="glow-${k}" r="50%"><stop offset="0" stop-color="${c.on[1]}" stop-opacity=".75"/><stop offset=".55" stop-color="${c.on[1]}" stop-opacity=".25"/><stop offset="1" stop-color="${c.on[1]}" stop-opacity="0"/></radialGradient>`;
  }).join("");
  const lamps = order.map((k, i) => {
    const cx = horizontal ? 50 + i * 80 : 50, cy = horizontal ? 50 : 50 + i * 80;
    const on = k === active;
    return `
    ${on ? `<circle cx="${cx}" cy="${cy}" r="46" fill="url(#glow-${k})"/>` : ""}
    <circle cx="${cx}" cy="${cy}" r="29" fill="#07080a"/>
    <circle cx="${cx}" cy="${cy}" r="26" fill="url(#${on ? "on" : "off"}-${k})"/>
    <ellipse cx="${cx - 7}" cy="${cy - 10}" rx="11" ry="6" fill="#fff" opacity="${on ? 0.55 : 0.08}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2f36"/><stop offset=".5" stop-color="#16181c"/><stop offset="1" stop-color="#0b0c0e"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b616b"/><stop offset="1" stop-color="#1a1c20"/></linearGradient>${defs}
  </defs>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="${horizontal ? 46 : 44}" fill="url(#body)" stroke="url(#rim)" stroke-width="3"/>
  ${lamps}
</svg>`;
}

export const loader = ({ params, request }: LoaderFunctionArgs) => {
  const lvl = (params.level || "green").replace(/\.svg$/, "") as L;
  const active: L = lvl in LAMPS ? lvl : "green";
  const horizontal = new URL(request.url).searchParams.get("o") === "h";
  return new Response(svg(active, horizontal), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" },
  });
};
